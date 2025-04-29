import { Bee, Bytes, EthAddress, FeedIndex, Identifier, PrivateKey, Topic } from '@ethersphere/bee-js';

import { ChainEmitter } from './ChainEmitter';
import { ErrorHandler } from './error';
import { Logger } from './logger';
import { Queue } from './queue';

const GSOC_BEE_URL = process.env.GSOC_BEE_URL!;
const GSOC_RESOURCE_ID = process.env.GSOC_RESOURCE_ID!;
const GSOC_TOPIC = process.env.GSOC_TOPIC!;

const STREAM_BEE_URL = process.env.STREAM_BEE_URL!;
const STREAM_TOPIC = process.env.STREAM_TOPIC!;
const STREAM_KEY = process.env.STREAM_KEY!;
const STREAM_STAMP = process.env.STREAM_STAMP!;

export class SwarmAggregator {
  private gsocBee: Bee;
  private writerBee: Bee;
  private index: FeedIndex | null;
  private streamSigner: PrivateKey;
  private chainEmitter: ChainEmitter;
  private logger = Logger.getInstance();
  private errorHandler = new ErrorHandler();
  private queue = new Queue();

  private messageCache = new Map<string, null>();
  private readonly maxCacheSize = 50_000;
  private readonly minCacheSize = 1_000;

  constructor() {
    this.chainEmitter = new ChainEmitter();
    this.gsocBee = new Bee(GSOC_BEE_URL);
    this.writerBee = new Bee(STREAM_BEE_URL);
    this.streamSigner = new PrivateKey(STREAM_KEY);
  }

  public async init() {
    try {
      const topic = Topic.fromString(STREAM_TOPIC);
      const publicKey = this.streamSigner.publicKey().address();

      this.logger.info('init topic:', topic.toHex());
      this.logger.info('init owner:', publicKey.toHex());

      const feedReader = this.writerBee.makeFeedReader(topic, publicKey);

      const data = await feedReader.downloadPayload();

      this.logger.info(`init feed index: ${data.feedIndex.toString()}`);
      this.index = data.feedIndex;
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        this.index = null;
      } else {
        this.errorHandler.handleError(error, 'SwarmAggregator.init');
      }
    }
  }

  //TODO: improve idea, process requests in a batch?
  public subscribeToGsoc() {
    const key = new PrivateKey(GSOC_RESOURCE_ID);
    const identifier = Identifier.fromString(GSOC_TOPIC);

    const gsocSub = this.gsocBee.gsocSubscribe(key.publicKey().address(), identifier, {
      onMessage: (message: Bytes) => this.queue.enqueue(() => this.gsocCallback(message)),
      onError: this.logger.error.bind(this.logger),
    });

    this.logger.info(`Subscribed to gsoc. Topic: ${GSOC_TOPIC} Resource ID: ${GSOC_RESOURCE_ID}`);

    return gsocSub;
  }

  // TODO: validation!
  private async gsocCallback(message: Bytes) {
    if (!this.shouldProcessMessage(message)) {
      this.logger.debug('Duplicate message dropped.');
      return;
    }

    const topic = Topic.fromString(STREAM_TOPIC);

    const newJsonData = JSON.parse(message.toUtf8());
    this.logger.info(`gsocCallback message: ${JSON.stringify(newJsonData)}`);

    let newState = [newJsonData];
    if (this.index !== null) {
      const previousState = await this.fetchPreviousState(this.streamSigner.publicKey().address(), topic, this.index);
      if (previousState) {
        newState = this.mergeState(previousState.payload, newJsonData);
      }
    }

    this.logger.info(`gsocCallback new state written`);

    const feedWriter = this.writerBee.makeFeedWriter(topic, this.streamSigner);
    const nextIndex = this.index ? this.index.next() : FeedIndex.fromBigInt(BigInt(0));

    const res = await feedWriter.uploadPayload(STREAM_STAMP, JSON.stringify(newState), {
      index: nextIndex,
    });

    this.logger.info(`gsocCallback feed write result: ${res.reference}`);

    await this.chainEmitter.emitEventWithRetry(`${STREAM_TOPIC}_${nextIndex.toString()}`);
    this.index = nextIndex;
  }

  // TODO: generalize this function based on a state convention, any
  private mergeState(previousState: Bytes, newData: any) {
    const jsonPreviousState = previousState.toJSON() as any[];

    const filteredState = jsonPreviousState.filter(
      entry => entry.owner !== newData.owner || entry.topic !== newData.topic,
    );

    filteredState.push(newData);

    return filteredState;
  }

  private async fetchPreviousState(owner: EthAddress, topic: Topic, index: FeedIndex) {
    const feedReader = this.gsocBee.makeFeedReader(topic, owner);

    try {
      const data = await feedReader.downloadPayload({
        index,
      });
      this.logger.info(`Fetched previous state: ${data.feedIndex.toString()}`);
      return data;
    } catch (error) {
      this.errorHandler.handleError(error, 'SwarmAggregator.fetchPreviousState');
      return null;
    }
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
