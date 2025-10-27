import { PrivateKey } from '@ethersphere/bee-js';
import { createLightNode, HealthStatus, type LightNode, ReliableChannel, WakuEvent } from '@solarpunkltd/waku-sdk';
import crypto from 'crypto';
import protobuf from 'protobufjs';

import { ErrorHandler } from '../libs/error.js';
import { Logger } from '../libs/logger.js';
import { StateArrayWithTimestamp } from '../types.js';
import { getEnvVariable, getShortMessageId, sleep } from '../utils/common.js';

const WAKU_STATIC_PEER = getEnvVariable('WAKU_STATIC_PEER');

export enum MessageStatus {
  Sending = 'sending',
  Sent = 'sent',
  Acknowledged = 'acknowledged',
  Failed = 'failed',
}

export enum HealthRecoveryType {
  Minimal = 'minimal',
  Unhealthy = 'unhealthy',
}

interface MessageTracker {
  messageId: string;
  timestamp: number;
  status: MessageStatus;
  retryCount: number;
  payload: Uint8Array;
}

interface ChannelListeners {
  messageSent: ((event: Event) => void) | null;
  messageAcknowledged: ((event: Event) => void) | null;
  sendError: ((event: Event) => void) | null;
}

export class WakuHandler {
  private logger = Logger.getInstance();
  private errorHandler = ErrorHandler.getInstance();

  private node: LightNode | null = null;
  private reliableChannel: ReliableChannel<any> | null = null;
  private streamListType: InstanceType<typeof protobuf.Type> | null = null;

  private contentTopic: string | null = null;
  private readonly channelName = 'solarpunk-msrs-stream-channel';
  private readonly senderId = crypto.randomBytes(8).toString('hex');

  private messageTrackers = new Map<string, MessageTracker>();
  private readonly maxRetries = 5;
  private currentHealth: HealthStatus = HealthStatus.Unhealthy;

  private nodeHealthListener: ((event: Event) => void) | null = null;
  private channelListeners: ChannelListeners = {
    messageSent: null,
    messageAcknowledged: null,
    sendError: null,
  };

  private static readonly RECOVERY_DELAY_MINIMAL = 8000;
  private static readonly RECOVERY_DELAY_UNHEALTHY = 10000;
  private static readonly RECOVERY_DELAY_RETRY = 20000;
  private static readonly NODE_RESTART_DELAY = 2000;

  constructor(streamKey: string, streamTopic: string) {
    const streamOwner = new PrivateKey(streamKey).publicKey().address().toHex().toLocaleLowerCase();
    this.contentTopic = `/solarpunk-msrs/1/${streamOwner}-${streamTopic}/proto`;
  }

  public async init(): Promise<void> {
    this.createProtobufSchema();
    await this.initializeWakuNode();
    this.logger.info('WakuHandler initialized with reliable channel');
  }

  private async initializeWakuNode(): Promise<void> {
    if (this.contentTopic === null) {
      throw new Error('Content topic is null');
    }

    await this.cleanupNodeAndChannel();

    this.node = await createLightNode({
      defaultBootstrap: true,
      bootstrapPeers: [WAKU_STATIC_PEER],
    });

    this.setupNodeEventListeners();

    const encoder = this.node.createEncoder({ contentTopic: this.contentTopic });
    const decoder = this.node.createDecoder({ contentTopic: this.contentTopic });

    this.reliableChannel = await ReliableChannel.create(this.node, this.channelName, this.senderId, encoder, decoder, {
      retryIntervalMs: 10000,
    });

    this.setupChannelEventListeners();
  }

  private createProtobufSchema(): void {
    const StreamEntryType = new protobuf.Type('StreamEntry')
      .add(new protobuf.Field('owner', 1, 'string'))
      .add(new protobuf.Field('topic', 2, 'string'))
      .add(new protobuf.Field('title', 3, 'string'))
      .add(new protobuf.Field('state', 4, 'string'))
      .add(new protobuf.Field('mediaType', 5, 'string'))
      .add(new protobuf.Field('createdAt', 6, 'uint64', 'optional'))
      .add(new protobuf.Field('updatedAt', 7, 'uint64', 'optional'))
      .add(new protobuf.Field('index', 8, 'uint32', 'optional'))
      .add(new protobuf.Field('duration', 9, 'uint32', 'optional'))
      .add(new protobuf.Field('thumbnail', 10, 'string', 'optional'))
      .add(new protobuf.Field('description', 11, 'string', 'optional'))
      .add(new protobuf.Field('scheduledStartTime', 12, 'string', 'optional'))
      .add(new protobuf.Field('pinned', 13, 'bool', 'optional'));

    this.streamListType = new protobuf.Type('StreamList')
      .add(StreamEntryType)
      .add(new protobuf.Field('entries', 1, 'StreamEntry', 'repeated'))
      .add(new protobuf.Field('lastModified', 2, 'uint64'));

    this.logger.info('Protobuf schema created');
  }

  private setupNodeEventListeners(): void {
    if (!this.node || !this.node.events) return;

    this.cleanupNodeListeners();

    this.nodeHealthListener = event => {
      this.handleHealthChange((event as CustomEvent).detail);
    };

    this.node.events.addEventListener(WakuEvent.Health, this.nodeHealthListener);
  }

  private cleanupNodeListeners(): void {
    if (this.node?.events && this.nodeHealthListener) {
      this.node.events.removeEventListener(WakuEvent.Health, this.nodeHealthListener);
      this.nodeHealthListener = null;
    }
  }

  private setupChannelEventListeners(): void {
    if (!this.reliableChannel) return;

    this.cleanupChannelListeners();

    this.channelListeners.messageSent = event => {
      this.handleMessageSent((event as CustomEvent).detail);
    };

    this.channelListeners.messageAcknowledged = event => {
      this.handleMessageAcknowledged((event as CustomEvent).detail);
    };

    this.channelListeners.sendError = event => {
      this.handleSendError((event as CustomEvent).detail);
    };

    this.reliableChannel.addEventListener('message-sent', this.channelListeners.messageSent!);
    this.reliableChannel.addEventListener('message-acknowledged', this.channelListeners.messageAcknowledged!);
    this.reliableChannel.addEventListener('sending-message-irrecoverable-error', this.channelListeners.sendError!);
  }

  private cleanupChannelListeners(): void {
    if (!this.reliableChannel) return;

    if (this.channelListeners.messageSent) {
      this.reliableChannel.removeEventListener('message-sent', this.channelListeners.messageSent);
      this.channelListeners.messageSent = null;
    }

    if (this.channelListeners.messageAcknowledged) {
      this.reliableChannel.removeEventListener('message-acknowledged', this.channelListeners.messageAcknowledged);
      this.channelListeners.messageAcknowledged = null;
    }

    if (this.channelListeners.sendError) {
      this.reliableChannel.removeEventListener('sending-message-irrecoverable-error', this.channelListeners.sendError);
      this.channelListeners.sendError = null;
    }
  }

  private async cleanupNodeAndChannel(): Promise<void> {
    if (this.reliableChannel) {
      this.cleanupChannelListeners();
      await this.reliableChannel.stop();
      this.reliableChannel = null;
    }

    if (this.node) {
      this.cleanupNodeListeners();
      await this.node.stop();
      this.node = null;
    }
  }

  private handleHealthChange(health: HealthStatus): void {
    if (this.currentHealth === health) {
      return;
    }

    this.currentHealth = health;

    switch (health) {
      case HealthStatus.SufficientlyHealthy:
        this.logger.info('Node health: Sufficiently healthy - fully operational');
        this.retryPendingMessages();
        break;
      case HealthStatus.MinimallyHealthy:
        this.logger.warn('Node health: Minimally healthy - may experience issues');
        this.attemptHealthRecovery(HealthRecoveryType.Minimal);
        break;
      case HealthStatus.Unhealthy:
        this.logger.error('Node health: Not healthy - disconnected from network');
        this.attemptHealthRecovery(HealthRecoveryType.Unhealthy);
        break;
    }
  }

  private async attemptHealthRecovery(healthType: HealthRecoveryType): Promise<void> {
    const recoveryDelay =
      healthType === HealthRecoveryType.Unhealthy
        ? WakuHandler.RECOVERY_DELAY_UNHEALTHY
        : WakuHandler.RECOVERY_DELAY_MINIMAL;

    this.logger.info(`Attempting health recovery in ${recoveryDelay}ms for ${healthType} health status...`);

    setTimeout(async () => {
      try {
        if (!this.node) {
          this.logger.error('Cannot recover: Node is null');
          return;
        }

        if (this.currentHealth === HealthStatus.Unhealthy || this.currentHealth === HealthStatus.MinimallyHealthy) {
          this.logger.info('Attempting to reconnect to Waku network...');

          await this.cleanupNodeAndChannel();
          await sleep(WakuHandler.NODE_RESTART_DELAY);

          await this.initializeWakuNode();

          this.logger.info('Health recovery attempt completed - node and channel recreated');
          this.retryPendingMessages();
        } else {
          this.logger.info('Health recovered naturally, no intervention needed');
        }
      } catch (error) {
        this.logger.error('Health recovery failed:', error);

        if (healthType === HealthRecoveryType.Unhealthy) {
          this.logger.info(`Scheduling another recovery attempt in ${WakuHandler.RECOVERY_DELAY_RETRY}ms...`);
          setTimeout(() => this.attemptHealthRecovery(HealthRecoveryType.Unhealthy), WakuHandler.RECOVERY_DELAY_RETRY);
        }
      }
    }, recoveryDelay);
  }

  private handleMessageSent(messageId: string): void {
    const tracker = this.messageTrackers.get(messageId);
    if (tracker) {
      tracker.status = MessageStatus.Sent;
      this.logger.info(`Message sent: ${getShortMessageId(messageId)}...`);
    }
  }

  private handleMessageAcknowledged(messageId: string): void {
    const tracker = this.messageTrackers.get(messageId);
    if (tracker) {
      tracker.status = MessageStatus.Acknowledged;
      this.logger.info(`Message acknowledged: ${getShortMessageId(messageId)}...`);

      setTimeout(() => {
        this.messageTrackers.delete(messageId);
      }, 5000);
    }
  }

  private handleSendError(detail: { messageId: string; error: Error }): void {
    const tracker = this.messageTrackers.get(detail.messageId);
    if (tracker) {
      tracker.status = MessageStatus.Failed;
      this.logger.error(`Failed to send message ${getShortMessageId(detail.messageId)}...: ${detail.error.message}`);

      if (tracker.retryCount < this.maxRetries) {
        this.retryMessage(tracker);
      } else {
        this.logger.error(`Message ${detail.messageId} failed after ${this.maxRetries} retries`);
        this.messageTrackers.delete(detail.messageId);
      }
    }
  }

  private async retryMessage(tracker: MessageTracker): Promise<void> {
    if (!this.reliableChannel) return;

    tracker.retryCount++;
    tracker.status = MessageStatus.Sending;

    const delay = Math.min(1000 * Math.pow(2, tracker.retryCount), 10000);
    await sleep(delay);

    this.logger.info(
      `Retrying message ${getShortMessageId(tracker.messageId)}... (attempt ${tracker.retryCount}/${this.maxRetries})`,
    );

    try {
      const newMessageId = this.reliableChannel.send(tracker.payload);

      this.messageTrackers.delete(tracker.messageId);
      tracker.messageId = newMessageId;
      this.messageTrackers.set(newMessageId, tracker);
    } catch (error) {
      this.logger.error(`Retry failed for message ${tracker.messageId}:`, error);
      tracker.status = MessageStatus.Failed;
    }
  }

  private async retryPendingMessages(): Promise<void> {
    const pendingMessages = Array.from(this.messageTrackers.values()).filter(
      t => t.status === MessageStatus.Failed && t.retryCount < this.maxRetries,
    );

    for (const tracker of pendingMessages) {
      this.retryMessage(tracker);
    }
  }

  public async sendStreamList(streamList: StateArrayWithTimestamp): Promise<{
    success: boolean;
    messageId: string;
    entriesCount: number;
    timestamp: number;
    status: string;
  }> {
    if (!this.reliableChannel || !this.streamListType) {
      throw new Error('WakuHandler not initialized');
    }

    const timestamp = Date.now();

    const streamListMessage = { entries: streamList.entries, lastModified: streamList.lastModified };
    const payload = this.streamListType.encode(this.streamListType.create(streamListMessage)).finish();

    const payloadArray = new Uint8Array(payload);

    try {
      const messageId = this.reliableChannel.send(payloadArray);

      const tracker: MessageTracker = {
        messageId,
        timestamp,
        status: MessageStatus.Sending,
        retryCount: 0,
        payload: payloadArray,
      };
      this.messageTrackers.set(messageId, tracker);

      this.logger.info(
        `Sending stream list with ID: ${getShortMessageId(messageId)}..., entries: ${streamList.entries.length}`,
      );

      await sleep(100);

      const finalTracker = this.messageTrackers.get(messageId);
      const status = finalTracker?.status || MessageStatus.Sending;

      return {
        success: status !== MessageStatus.Failed,
        messageId,
        entriesCount: streamList.entries.length,
        timestamp,
        status,
      };
    } catch (error) {
      this.errorHandler.handleError(error, 'WakuHandler.sendUniqueStreamList');
      throw error;
    }
  }

  public async cleanup(): Promise<void> {
    this.logger.info('Starting WakuHandler cleanup...');

    this.messageTrackers.clear();

    await this.cleanupNodeAndChannel();

    this.logger.info('WakuHandler cleanup completed');
  }
}
