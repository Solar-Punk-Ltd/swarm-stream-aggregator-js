import { PrivateKey } from '@ethersphere/bee-js';
import { Encoder } from '@waku/sdk';
import path from 'path';
import protobuf from 'protobufjs';
import { fileURLToPath } from 'url';

import { Logger } from '../libs/logger.js';
import { StateEntry } from '../types.js';
import { Waku } from '../waku/Waku.js';

const { load } = protobuf;
type Root = protobuf.Root;
type Type = protobuf.Type;

export class WakuPublish {
  private logger = Logger.getInstance();

  private wakuPush: Waku;
  private encoder: Encoder | null = null;

  private protoRoot: Root | null = null;
  private streamListType: Type | null = null;

  constructor(private streamKey: string, private streamTopic: string) {
    this.wakuPush = new Waku();
  }

  public async init(): Promise<void> {
    // Load protobuf definitions
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    this.protoRoot = await load(path.join(__dirname, '../waku/streamList.proto'));
    this.protoRoot.resolveAll();
    this.streamListType = this.protoRoot.lookupType('StreamList');

    const signerPublicKey = new PrivateKey(this.streamKey).publicKey().address().toHex().toLocaleLowerCase();
    const topicName = `${signerPublicKey}-${this.streamTopic}`;
    this.encoder = this.wakuPush.createWakuEncoder(topicName);

    this.logger.info(`WakuPublish initialized for stream: ${topicName}`);
  }

  public async publishStreamListUpdate(streamList: StateEntry[]): Promise<void> {
    if (!this.encoder || !this.streamListType) {
      throw new Error('WakuPublish not initialized');
    }

    const streamListMessage = {
      entries: streamList,
    };

    const payload = this.streamListType.encode(this.streamListType.create(streamListMessage)).finish();

    await this.wakuPush.publishMessage(this.encoder, new Uint8Array(payload));

    this.logger.info(`Published stream list update with ${streamList.length} entries`);
  }
}
