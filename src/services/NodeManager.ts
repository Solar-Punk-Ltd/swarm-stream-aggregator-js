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
  ): Array<{ port: string; stamp: string; lock_info?: any }> {
    const normalizedStreamId = streamId.toLowerCase();
    const streamStamps: Array<{ port: string; stamp: string; lock_info?: any }> = [];

    for (const node of status.nodes.private_writers) {
      for (const stampInfo of node.stamps) {
        if (stampInfo.lock_info?.stream_id?.toLowerCase() === normalizedStreamId) {
          streamStamps.push({
            port: node.port,
            stamp: stampInfo.stamp,
            lock_info: stampInfo.lock_info,
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
        throw new Error(`No locked stamps found for stream ID: ${streamId}`);
      }

      this.logger.info(`Setting stream ${streamId} to ${pinned ? 'pinned' : 'unpinned'}`);

      const results: LockResult[] = [];

      for (const { port, stamp, lock_info } of streamStamps) {
        if (lock_info.pinned === pinned) {
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

  public async unlockNode(port: string, stamp?: string, force = false): Promise<void> {
    try {
      const payload: { port: string; stamp?: string; force: boolean } = { port, force };
      if (stamp) {
        payload.stamp = stamp;
      }

      await this.axios.post('/admin/node/unlock', payload);

      const stampInfo = stamp ? ` stamp ${stamp}` : '';
      this.logger.info(`Unlocked${stampInfo} on port ${port}`);
    } catch (error: any) {
      if (error.response?.status === 423) {
        const stampInfo = stamp ? ` stamp ${stamp}` : '';
        throw new Error(`Port ${port}${stampInfo} is pinned - use force to unlock`);
      }
      if (error.response?.status === 404) {
        const stampInfo = stamp ? ` stamp ${stamp}` : '';
        throw new Error(`Port ${port}${stampInfo} is not locked`);
      }
      this.errorHandler.handleError(error, 'NodeManager.unlockNode');
      throw error;
    }
  }

  public async unlockStreamNodes(streamId: string, force = true): Promise<void> {
    try {
      const statusResponse = await this.axios.get('/admin/node/status');
      const status = statusResponse.data as StatusResponse;

      const streamStamps = this.findStreamStamps(status, streamId);

      if (streamStamps.length === 0) {
        this.logger.info(`No stamps found for stream ${streamId} - nothing to unlock`);
        return;
      }

      this.logger.info(`Unlocking ${streamStamps.length} stamps for stream ${streamId}`);

      for (const { port, stamp } of streamStamps) {
        try {
          await this.unlockNode(port, stamp, force);
          this.logger.info(`${force ? 'Force ' : ''}unlocked stamp ${stamp} on port ${port} for stream ${streamId}`);
        } catch (error) {
          this.errorHandler.handleError(error, `NodeManager.unlockStreamNodes.unlockNode[${port}:${stamp}]`);
          // Continue with other stamps even if one fails
        }
      }
    } catch (error) {
      this.errorHandler.handleError(error, 'NodeManager.unlockStreamNodes');
      throw error;
    }
  }
}
