import axios, { AxiosInstance } from 'axios';

import { ErrorHandler } from '../libs/error.js';
import { Logger } from '../libs/logger.js';

export enum NodeType {
  MEDIA = 'media',
  CHAT = 'chat',
}

interface StampInfo {
  stamp: string;
  state: string;
  lock_info?: {
    locked_at: number;
    locked_by: string;
    stream_id: string;
    type: NodeType;
    pinned: boolean;
  };
  history?: {
    stream_id: string;
    type: NodeType;
    unlocked_at: number;
    locked_at: number;
    locked_by: string;
    pinned: boolean;
  };
}

interface PrivateWriterNode {
  port: string;
  total_stamps: number;
  stamps: StampInfo[];
}

interface PublicWriterNode {
  port: string;
  hash: string;
}

interface ReaderNode {
  status: string;
  port: number;
}

interface StampLocation {
  port: string;
  stamp: string;
}

interface StatusResponse {
  instance: string;
  timestamp: number;
  persistence: {
    exists: boolean;
    modified: number;
    path: string;
  };
  nodes: {
    private_writers: PrivateWriterNode[];
    public_writers: PublicWriterNode[];
    readers: ReaderNode[];
  };
  summary: {
    stamps: {
      total: number;
      locked: number;
      locked_pinned: number;
      history_unpinned: number;
      history_pinned: number;
      free: number;
    };
  };
}

export class NodeManager {
  private axios: AxiosInstance;
  private errorHandler = ErrorHandler.getInstance();
  private logger = Logger.getInstance();

  constructor(private gatewayUrl: string, private adminSecret: string) {
    this.axios = axios.create({
      baseURL: this.gatewayUrl,
      headers: {
        'X-MSRS-Admin-Token': this.adminSecret,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
  }

  public async toggleStreamPin(streamId: string, pinned: boolean): Promise<void> {
    try {
      const historyStamps = await this.findHistoryStamps(streamId);

      if (historyStamps.length === 0) {
        throw new Error(`No history stamps found for stream ID: ${streamId}`);
      }

      this.logger.info(
        `Setting stream ${streamId} to ${pinned ? 'pinned' : 'unpinned'} (${historyStamps.length} history stamp(s))`,
      );

      await Promise.all(historyStamps.map(({ port, stamp }) => this.toggleStampPin(port, stamp, pinned)));
    } catch (error) {
      this.errorHandler.handleError(error, 'NodeManager.toggleStreamPin');
      throw error;
    }
  }

  private async findHistoryStamps(streamId: string): Promise<StampLocation[]> {
    const statusResponse = await this.axios.get('/admin/node/status');
    const status = statusResponse.data as StatusResponse;
    const normalizedStreamId = streamId.toLowerCase();

    const historyStamps: StampLocation[] = [];

    for (const node of status.nodes.private_writers) {
      for (const stampInfo of node.stamps) {
        if (stampInfo.history?.stream_id?.toLowerCase() === normalizedStreamId) {
          historyStamps.push({
            port: node.port,
            stamp: stampInfo.stamp,
          });
        }
      }
    }

    return historyStamps;
  }

  private async toggleStampPin(port: string, stamp: string, pinned: boolean): Promise<void> {
    await this.axios.post('/admin/node/pin', {
      port,
      stamp,
      pinned,
    });

    this.logger.info(`${pinned ? 'Pinned' : 'Unpinned'} stamp ${stamp} on port ${port}`);
  }
}
