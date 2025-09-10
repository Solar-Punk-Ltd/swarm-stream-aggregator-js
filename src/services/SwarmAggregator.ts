import { Bee, Bytes, FeedIndex, Identifier, PrivateKey, Topic } from '@ethersphere/bee-js';
import PQueue from 'p-queue';

import { ErrorHandler } from '../libs/error.js';
import { Logger } from '../libs/logger.js';
import { StateEntry } from '../types.js';

import { AuthService } from './AuthService.js';
import { MessageProcessor } from './MessageProcessor.js';
import { StateManager } from './StateManager.js';

const GSOC_BEE_URL = process.env.GSOC_BEE_URL!;
const GSOC_RESOURCE_ID = process.env.GSOC_RESOURCE_ID!;
const GSOC_TOPIC = process.env.GSOC_TOPIC!;

const STREAM_BEE_URL = process.env.STREAM_BEE_URL!;
const STREAM_TOPIC = process.env.STREAM_TOPIC!;
const STREAM_KEY = process.env.STREAM_KEY!;
const STREAM_STAMP = process.env.STREAM_STAMP!;

const API_KEY = process.env.API_KEY!;
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === 'true';

export class SwarmAggregator {
  private gsocBee: Bee;
  private writerBee: Bee;
  private streamSigner: PrivateKey;
  private index: FeedIndex | null = null;
  private logger = Logger.getInstance();
  private errorHandler = new ErrorHandler();
  private queue = new PQueue({
    concurrency: 1,
  });

  private authService: AuthService;
  private stateManager: StateManager;
  private messageProcessor: MessageProcessor;

  // Message deduplication cache
  private messageCache = new Map<string, null>();
  private readonly maxCacheSize = 50_000;
  private readonly minCacheSize = 1_000;

  constructor() {
    this.gsocBee = new Bee(GSOC_BEE_URL);
    this.writerBee = new Bee(STREAM_BEE_URL);
    this.streamSigner = new PrivateKey(STREAM_KEY);

    const config = {
      apiKey: API_KEY,
      requireAuth: REQUIRE_AUTH,
    };

    this.authService = new AuthService(config);
    this.stateManager = new StateManager();
    this.messageProcessor = new MessageProcessor(this.authService, this.stateManager);
  }

  public async init() {
    try {
      const topic = Topic.fromString(STREAM_TOPIC);
      const publicKey = this.streamSigner.publicKey().address();

      this.logger.info('init topic:', topic.toHex());
      this.logger.info('init owner:', publicKey.toHex());
      this.logger.info(`init auth enabled: ${REQUIRE_AUTH}`);

      const feedReader = this.writerBee.makeFeedReader(topic, publicKey);

      const data = await feedReader.downloadPayload();

      this.logger.info(`init feed index: ${data.feedIndex.toString()}`);
      this.index = data.feedIndex;
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        this.index = null;
        this.logger.info('init: No existing feed found, starting fresh');
      } else {
        this.errorHandler.handleError(error, 'SwarmAggregator.init');
      }
    }
  }

  public subscribeToGsoc() {
    const key = new PrivateKey(GSOC_RESOURCE_ID);
    const identifier = Identifier.fromString(GSOC_TOPIC);

    const gsocSub = this.gsocBee.gsocSubscribe(key.publicKey().address(), identifier, {
      onMessage: (message: Bytes) => this.queue.add(() => this.gsocCallback(message)),
      onError: this.logger.error.bind(this.logger),
    });

    this.logger.info(`Subscribed to gsoc. Topic: ${GSOC_TOPIC} Resource ID: ${GSOC_RESOURCE_ID}`);

    return gsocSub;
  }

  private async gsocCallback(message: Bytes) {
    try {
      if (!this.shouldProcessMessage(message)) {
        this.logger.debug('Duplicate message dropped.');
        return;
      }

      const previousState = await this.fetchPreviousState();

      const result = await this.messageProcessor.processMessage(message, previousState || []);

      if (!result.success) {
        this.logger.error(`Failed to process message: ${result.error}`);
        return;
      }

      if (result.state) {
        await this.writeStateToFeed(result.state);
      }
    } catch (error) {
      this.errorHandler.handleError(error, 'SwarmAggregator.gsocCallback');
    }
  }

  private async fetchPreviousState(): Promise<StateEntry[] | null> {
    if (this.index === null) {
      return null;
    }

    const topic = Topic.fromString(STREAM_TOPIC);
    const owner = this.streamSigner.publicKey().address();
    const feedReader = this.writerBee.makeFeedReader(topic, owner);

    try {
      const data = await feedReader.downloadPayload({
        index: this.index,
      });

      this.logger.info(`Fetched previous state: ${data.feedIndex.toString()}`);

      const jsonState = data.payload.toJSON() as StateEntry[];
      return jsonState;
    } catch (error) {
      this.errorHandler.handleError(error, 'SwarmAggregator.fetchPreviousState');
      return null;
    }
  }

  private async writeStateToFeed(state: StateEntry[]): Promise<void> {
    const topic = Topic.fromString(STREAM_TOPIC);
    const feedWriter = this.writerBee.makeFeedWriter(topic, this.streamSigner);
    const nextIndex = this.index ? this.index.next() : FeedIndex.fromBigInt(BigInt(0));

    const res = await feedWriter.uploadPayload(STREAM_STAMP, JSON.stringify(state), {
      index: nextIndex,
    });

    this.logger.info(`Feed write result: ${res.reference}, Index: ${nextIndex.toString()}`);
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
}
