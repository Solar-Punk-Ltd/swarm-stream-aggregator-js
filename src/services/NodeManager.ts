import axios, { AxiosInstance } from 'axios';

import { ErrorHandler } from '../libs/error.js';
import { Logger } from '../libs/logger.js';

export enum NodeType {
  MEDIA = 'media',
  CHAT = 'chat',
}

interface StampInfo {
  stamp: string;
  locked: boolean;
  lock_info?: {
    locked_at: number;
    locked_by: string;
    instance: string;
    stream_id: string;
    type: NodeType;
    pinned: boolean;
  };
  history?: {
    stream_id: string;
    type: NodeType;
    unlocked_at: number;
    was_pinned: boolean;
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

interface StatusResponse {
  nodes: {
    private_writers: PrivateWriterNode[];
    public_writers: PublicWriterNode[];
    readers: ReaderNode[];
  };
  summary: {
    total_private_writers: number;
    total_private_writer_stamps: number;
    locked_private_writers: number;
    locked_private_writer_stamps: number;
    pinned_private_writers: number;
    pinned_private_writer_stamps: number;
    available_private_writers: number;
    available_private_writer_stamps: number;
    total_public_writers: number;
    total_readers: number;
  };
  instance: string;
  persistence: {
    file: string;
    file_info: {
      exists: boolean;
    };
  };
}

interface LockResult {
  port: string;
  stamp: string;
  lockData: {
    locked_at: number;
    locked_by: string;
    instance: string;
    stream_id: string;
    type: NodeType;
    pinned: boolean;
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

  private findStreamStamps(
    status: StatusResponse,
    streamId: string,
  ): Array<{
    port: string;
    stamp: string;
    lock_info?: StampInfo['lock_info'];
    history?: StampInfo['history'];
  }> {
    const normalizedStreamId = streamId.toLowerCase();
    const streamStamps: Array<{
      port: string;
      stamp: string;
      lock_info?: StampInfo['lock_info'];
      history?: StampInfo['history'];
    }> = [];

    for (const node of status.nodes.private_writers) {
      for (const stampInfo of node.stamps) {
        if (stampInfo.lock_info?.stream_id?.toLowerCase() === normalizedStreamId) {
          streamStamps.push({
            port: node.port,
            stamp: stampInfo.stamp,
            lock_info: stampInfo.lock_info,
          });
        } else if (stampInfo.history?.stream_id?.toLowerCase() === normalizedStreamId) {
          streamStamps.push({
            port: node.port,
            stamp: stampInfo.stamp,
            history: stampInfo.history,
          });
        }
      }
    }

    return streamStamps;
  }

  public async toggleStreamPin(streamId: string, pinned: boolean): Promise<LockResult[]> {
    try {
      const statusResponse = await this.axios.get('/admin/node/status');
      const status = statusResponse.data as StatusResponse;

      const streamStamps = this.findStreamStamps(status, streamId);

      if (streamStamps.length === 0) {
        throw new Error(`No stamps found for stream ID: ${streamId}`);
      }

      this.logger.info(
        `Setting stream ${streamId} to ${pinned ? 'pinned' : 'unpinned'} (${streamStamps.length} stamp(s))`,
      );

      const results: LockResult[] = [];

      // Defensive: Only pin first media and first chat stamp
      // Check both locked stamps and history
      const mediaStamp = streamStamps.find(
        s => s.lock_info?.type === NodeType.MEDIA || s.history?.type === NodeType.MEDIA,
      );
      const chatStamp = streamStamps.find(
        s => s.lock_info?.type === NodeType.CHAT || s.history?.type === NodeType.CHAT,
      );

      const stampsToPin = [mediaStamp, chatStamp].filter(
        (s): s is NonNullable<typeof s> => s !== undefined && s !== null,
      );

      if (stampsToPin.length === 0) {
        throw new Error(`No media/chat stamps found for stream ${streamId}`);
      }

      for (const { port, stamp, lock_info, history } of stampsToPin) {
        const currentPinned = lock_info?.pinned ?? history?.was_pinned ?? false;

        if (currentPinned === pinned) {
          this.logger.debug(
            `Stamp ${stamp} on port ${port} already has correct pin state: ${pinned ? 'pinned' : 'unpinned'}`,
          );
          continue;
        }

        const pinResponse = await this.axios.post('/admin/node/pin', {
          port,
          stamp,
          pinned,
        });

        results.push({
          port,
          stamp,
          lockData: pinResponse.data.lock_data,
        });

        this.logger.info(`${pinned ? 'Pinned' : 'Unpinned'} stamp ${stamp} on port ${port} for stream ${streamId}`);
      }

      return results;
    } catch (error) {
      this.errorHandler.handleError(error, 'NodeManager.toggleStreamPin');
      throw error;
    }
  }
}
