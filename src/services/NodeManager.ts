import axios, { AxiosInstance } from 'axios';

import { ErrorHandler } from '../libs/error.js';
import { Logger } from '../libs/logger.js';

export enum NodeType {
  MEDIA = 'media',
  CHAT = 'chat',
}

interface NodeInfo {
  port: string;
  hash: string;
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

interface StatusResponse {
  nodes: {
    private_writers: NodeInfo[];
    public_writers: NodeInfo[];
    readers: any[];
  };
  summary: {
    total_private_writers: number;
    locked_private_writers: number;
    pinned_private_writers: number;
    available_private_writers: number;
  };
}

interface LockResult {
  port: string;
  hash: string;
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

  public async toggleStreamPin(streamId: string, pinned: boolean): Promise<LockResult[]> {
    try {
      const statusResponse = await this.axios.get('/admin/node/status');
      const status = statusResponse.data as StatusResponse;

      const normalizedStreamId = streamId.toLowerCase();
      const streamNodes = status.nodes.private_writers.filter(
        node => node.lock_info?.stream_id?.toLowerCase() === normalizedStreamId,
      );

      if (streamNodes.length === 0) {
        throw new Error(`No locked nodes found for stream ID: ${streamId}`);
      }

      this.logger.info(`Setting stream ${streamId} to ${pinned ? 'pinned' : 'unpinned'}`);

      const results: LockResult[] = [];

      for (const node of streamNodes) {
        const { port, lock_info } = node;

        if (!lock_info) {
          continue;
        }

        if (lock_info.pinned === pinned) {
          this.logger.debug(`Node ${port} already has correct pin state: ${pinned ? 'pinned' : 'unpinned'}`);
          continue;
        }

        const pinResponse = await this.axios.post('/admin/node/pin', {
          port,
          pinned,
        });

        results.push({
          port,
          hash: node.hash,
          lockData: pinResponse.data.lock_data,
        });

        this.logger.info(`${pinned ? 'Pinned' : 'Unpinned'} node ${port} for stream ${streamId}`);
      }

      return results;
    } catch (error) {
      this.errorHandler.handleError(error, 'NodeManager.toggleStreamPin');
      throw error;
    }
  }

  public async unlockNode(port: string, force = false): Promise<void> {
    try {
      await this.axios.post('/admin/node/unlock', { port, force });
      this.logger.info(`Unlocked node ${port}`);
    } catch (error: any) {
      if (error.response?.status === 423) {
        throw new Error(`Node ${port} is pinned - use force to unlock`);
      }
      if (error.response?.status === 404) {
        throw new Error(`Node ${port} is not locked`);
      }
      this.errorHandler.handleError(error, 'NodeManager.unlockNode');
      throw error;
    }
  }

  public async unlockStreamNodes(streamId: string, force = true): Promise<void> {
    try {
      const statusResponse = await this.axios.get('/admin/node/status');
      const status = statusResponse.data as StatusResponse;

      const normalizedStreamId = streamId.toLowerCase();
      const streamNodes = status.nodes.private_writers.filter(
        node => node.lock_info?.stream_id?.toLowerCase() === normalizedStreamId,
      );

      if (streamNodes.length === 0) {
        this.logger.info(`No nodes found for stream ${streamId} - nothing to unlock`);
        return;
      }

      this.logger.info(`Unlocking ${streamNodes.length} nodes for stream ${streamId}`);

      for (const node of streamNodes) {
        try {
          await this.unlockNode(node.port, force);
          this.logger.info(`${force ? 'Force ' : ''}unlocked node ${node.port} for stream ${streamId}`);
        } catch (error) {
          this.logger.error(`Failed to unlock node ${node.port}:`, error);
          // Continue with other nodes even if one fails
        }
      }
    } catch (error) {
      this.errorHandler.handleError(error, 'NodeManager.unlockStreamNodes');
      throw error;
    }
  }
}
