import { Bee, BeeError, Bytes, FeedIndex, GsocSubscription, Identifier, PrivateKey, Topic } from '@ethersphere/bee-js';
import PQueue from 'p-queue';

import { ErrorHandler } from '../libs/error.js';
import { Logger } from '../libs/logger.js';
import { StateArrayWithTimestamp } from '../types.js';
import { reconnectDelayMs } from '../utils/backoff.js';
import { getBooleanEnvVariable, getEnvVariable } from '../utils/common.js';

import { AuthService } from './AuthService.js';
import { LiveJanitor, StateFeedAccess } from './LiveJanitor.js';
import { MessageProcessor } from './MessageProcessor.js';
import { NodeManager } from './NodeManager.js';
import { StateManager } from './StateManager.js';
import { WakuHandler } from './Waku.js';

const GSOC_BEE_URL = getEnvVariable('GSOC_BEE_URL');
const GSOC_RESOURCE_ID = getEnvVariable('GSOC_RESOURCE_ID');
const GSOC_TOPIC = getEnvVariable('GSOC_TOPIC');

const STREAM_BEE_URL = getEnvVariable('STREAM_BEE_URL');
const STREAM_TOPIC = getEnvVariable('STREAM_TOPIC');
const STREAM_KEY = getEnvVariable('STREAM_KEY');
const STREAM_STAMP = getEnvVariable('STREAM_STAMP');

const API_KEY = getEnvVariable('API_KEY');
const REQUIRE_AUTH = getEnvVariable('REQUIRE_AUTH') === 'true';
const NGINX_ADMIN_SECRET = getEnvVariable('NGINX_ADMIN_SECRET');
const IS_WAKU_ENABLED = getBooleanEnvVariable('IS_WAKU_ENABLED', true);

// MSRS gateway specific settings
const GATEWAY_URL = new URL(STREAM_BEE_URL).origin;

export class SwarmAggregator implements StateFeedAccess {
  private gsocBee: Bee;
  private writerBee: Bee;
  private streamSigner: PrivateKey;
  private index: FeedIndex | null = null;
  private logger = Logger.getInstance();
  private errorHandler = ErrorHandler.getInstance();
  private queue = new PQueue({
    concurrency: 1,
  });

  private authService: AuthService;
  private stateManager: StateManager;
  private messageProcessor: MessageProcessor;
  private nodeManager: NodeManager;
  private liveJanitor: LiveJanitor;
  private wakuHandler: WakuHandler | null = null;

  private messageCache = new Map<string, null>();
  private readonly maxCacheSize = 50_000;
  private readonly minCacheSize = 1_000;

  private isInitialized = false;
  private isShuttingDown = false;

  private gsocSubscription: GsocSubscription | null = null;
  private gsocReconnectAttempt = 0;
  private gsocReconnectTimer: NodeJS.Timeout | null = null;
  private isGsocStopped = false;

  constructor() {
    this.gsocBee = new Bee(GSOC_BEE_URL, {
      headers: {
        'X-MSRS-Admin-Token': NGINX_ADMIN_SECRET,
      },
    });
    this.writerBee = new Bee(STREAM_BEE_URL);
    this.streamSigner = new PrivateKey(STREAM_KEY);

    const config = {
      apiKey: API_KEY,
      requireAuth: REQUIRE_AUTH,
    };

    this.authService = new AuthService(config);
    this.nodeManager = new NodeManager(GATEWAY_URL, NGINX_ADMIN_SECRET);
    this.stateManager = new StateManager(this.nodeManager);
    this.messageProcessor = new MessageProcessor(this.authService, this.stateManager);
    this.liveJanitor = new LiveJanitor(this.writerBee, this.stateManager, this);
  }

  public async init() {
    if (this.isInitialized) {
      this.logger.warn('SwarmAggregator already initialized');
      return;
    }

    try {
      const topic = Topic.fromString(STREAM_TOPIC);
      const publicKey = this.streamSigner.publicKey().address();

      this.logger.info('init topic:', topic.toHex());
      this.logger.info('init owner:', publicKey.toHex());
      this.logger.info(`init auth enabled: ${REQUIRE_AUTH}`);
      this.logger.info(`init waku enabled: ${IS_WAKU_ENABLED}`);

      const feedReader = this.writerBee.feed.makeReader(topic, publicKey);

      await this.initializeWaku();

      const data = await feedReader.downloadPayload();

      this.logger.info(`init feed index: ${data.feedIndex.toString()}`);
      this.index = data.feedIndex;

      this.isInitialized = true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        this.index = null;
        this.logger.info('init: No existing feed found, starting fresh');
        this.isInitialized = true;
      } else {
        this.errorHandler.handleError(error, 'SwarmAggregator.init');
        throw error;
      }
    }
  }

  private async initializeWaku(): Promise<void> {
    if (!IS_WAKU_ENABLED) {
      this.logger.info('Waku is disabled, skipping initialization');
      return;
    }

    try {
      this.wakuHandler = new WakuHandler(STREAM_KEY, STREAM_TOPIC);
      await this.wakuHandler.init();
      this.logger.info('Waku handler initialized successfully');
    } catch (error) {
      this.errorHandler.handleError(error, 'SwarmAggregator.initializeWaku');
      this.wakuHandler = null;
    }
  }

  public subscribeToGsoc(): GsocSubscription {
    const key = new PrivateKey(GSOC_RESOURCE_ID);
    const identifier = Identifier.fromString(GSOC_TOPIC);

    const subscription = this.gsocBee.messaging.gsocSubscribe(key.publicKey().address(), identifier, {
      onMessage: (message: Bytes) => {
        this.gsocReconnectAttempt = 0;
        this.queue.add(() => this.gsocCallback(message));
      },
      onError: (error: BeeError) => this.logger.error('[GSOC] Subscription error:', error.message),
      // Bee drops the socket whenever the gateway in front of it restarts, and a dropped socket is
      // silent: no message ever arrives again. Reopen it, or the list stays frozen until a redeploy.
      onClose: () => this.scheduleGsocResubscribe(),
    });

    this.gsocSubscription = subscription;
    this.logger.info(`Subscribed to gsoc. Topic: ${GSOC_TOPIC} Resource ID: ${GSOC_RESOURCE_ID}`);

    return subscription;
  }

  /** Closes the subscription for good; the close this causes must not reopen it. */
  public unsubscribeFromGsoc(): void {
    this.isGsocStopped = true;
    if (this.gsocReconnectTimer) {
      clearTimeout(this.gsocReconnectTimer);
      this.gsocReconnectTimer = null;
    }
    this.gsocSubscription?.cancel();
    this.gsocSubscription = null;
  }

  private scheduleGsocResubscribe(): void {
    if (this.isGsocStopped || this.isShuttingDown || this.gsocReconnectTimer) {
      return;
    }

    const delayMs = reconnectDelayMs(this.gsocReconnectAttempt);
    this.gsocReconnectAttempt += 1;
    this.logger.warn(`[GSOC] Subscription closed, resubscribing in ${delayMs} ms`);

    this.gsocReconnectTimer = setTimeout(() => {
      this.gsocReconnectTimer = null;
      try {
        this.subscribeToGsoc();
      } catch (error) {
        this.errorHandler.handleError(error, 'SwarmAggregator.scheduleGsocResubscribe');
        this.scheduleGsocResubscribe();
      }
    }, delayMs);
  }

  public startLiveJanitor(): void {
    this.liveJanitor.start();
  }

  public stopLiveJanitor(): void {
    this.liveJanitor.stop();
  }

  private async gsocCallback(message: Bytes) {
    try {
      if (!this.shouldProcessMessage(message)) {
        this.logger.debug('Duplicate message dropped.');
        return;
      }

      const previousState = await this.fetchPreviousState();

      const result = await this.messageProcessor.processMessage(
        message,
        previousState || {
          entries: [],
          lastModified: Date.now(),
        },
      );

      if (!result.success) {
        this.errorHandler.handleError(result.error, 'SwarmAggregator.gsocCallback');
        return;
      }

      if (result.state) {
        await this.writeStateToFeed(result.state);
      }
    } catch (error) {
      this.errorHandler.handleError(error, 'SwarmAggregator.gsocCallback');
    }
  }

  private async fetchPreviousState(): Promise<StateArrayWithTimestamp | null> {
    if (this.index === null) {
      return null;
    }

    const topic = Topic.fromString(STREAM_TOPIC);
    const owner = this.streamSigner.publicKey().address();
    const feedReader = this.writerBee.feed.makeReader(topic, owner);

    try {
      const data = await feedReader.downloadPayload({
        index: this.index,
      });

      this.logger.info(`Fetched previous state: ${data.feedIndex.toString()}`);

      const jsonState = data.payload.toJSON() as StateArrayWithTimestamp;
      return jsonState;
    } catch (error) {
      this.errorHandler.handleError(error, 'SwarmAggregator.fetchPreviousState');
      return null;
    }
  }

  public readState(): Promise<StateArrayWithTimestamp | null> {
    return this.fetchPreviousState();
  }

  /**
   * Runs a read-modify-write of the state feed on the same queue the GSOC messages use, so an
   * out-of-band mutation cannot interleave with an incoming message and reuse a feed index.
   * The callback returns null to leave the feed untouched. Resolves to true only when a new
   * state was actually persisted.
   */
  public async commitSerialized(
    mutate: (currentState: StateArrayWithTimestamp) => Promise<StateArrayWithTimestamp | null>,
  ): Promise<boolean> {
    const hasWritten = await this.queue.add(async () => {
      try {
        const previousState = await this.fetchPreviousState();
        if (!previousState) {
          return false;
        }

        const nextState = await mutate(previousState);
        if (!nextState) {
          return false;
        }

        await this.writeStateToFeed(nextState);
        return true;
      } catch (error) {
        this.errorHandler.handleError(error, 'SwarmAggregator.commitSerialized');
        return false;
      }
    });

    return hasWritten === true;
  }

  private async writeStateToFeed(state: StateArrayWithTimestamp): Promise<void> {
    const topic = Topic.fromString(STREAM_TOPIC);
    const feedWriter = this.writerBee.feed.makeWriter(topic, this.streamSigner);
    const nextIndex = this.index ? this.index.next() : FeedIndex.fromBigInt(BigInt(0));

    const promises: Promise<any>[] = [
      feedWriter.uploadPayload(STREAM_STAMP, JSON.stringify(state), {
        index: nextIndex,
      }),
    ];

    if (this.wakuHandler) {
      promises.push(this.wakuHandler.sendStreamList(state));
    }

    const [feedRes] = await Promise.all(promises);

    this.logger.info(`Feed write result: ${feedRes.reference}, Index: ${nextIndex.toString()}`);
    this.index = nextIndex;
  }

  private shouldProcessMessage(message: Bytes): boolean {
    const key = message.toHex();

    if (this.messageCache.has(key)) {
      return false;
    }

    this.messageCache.set(key, null);

    if (this.messageCache.size > this.maxCacheSize) {
      const excess = this.messageCache.size - this.minCacheSize;
      const keys = this.messageCache.keys();

      for (let i = 0; i < excess; i++) {
        const oldestKey = keys.next().value;
        if (oldestKey !== undefined) {
          this.messageCache.delete(oldestKey);
        }
      }

      this.logger.info(`Message cache pruned. Kept last ${this.minCacheSize} entries.`);
    }

    return true;
  }

  public async cleanup(): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn('SwarmAggregator cleanup already in progress');
      return;
    }

    this.isShuttingDown = true;
    this.logger.info('Starting SwarmAggregator cleanup...');

    try {
      this.liveJanitor.stop();

      this.queue.clear();
      await this.queue.onIdle();

      this.messageCache.clear();

      if (this.wakuHandler) {
        try {
          await this.wakuHandler.cleanup();
          this.logger.info('Waku handler cleaned up successfully');
        } catch (error) {
          this.errorHandler.handleError(error, 'SwarmAggregator.cleanup.waku');
        }
        this.wakuHandler = null;
      }

      this.isInitialized = false;
      this.logger.info('SwarmAggregator cleanup completed');
    } catch (error) {
      this.errorHandler.handleError(error, 'SwarmAggregator.cleanup');
      throw error;
    }
  }
}
