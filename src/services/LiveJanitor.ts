import { Bee, Topic } from '@ethersphere/bee-js';

import { ErrorHandler } from '../libs/error.js';
import { Logger } from '../libs/logger.js';
import { StateArrayWithTimestamp, StateEntry, StateType } from '../types.js';
import { getNumberEnvVariable } from '../utils/common.js';
import { decideVodUpdate } from '../utils/manifest.js';

import { StateManager } from './StateManager.js';

const DEFAULT_JANITOR_INTERVAL_MS = 5 * 60 * 1000;
const JANITOR_INTERVAL_MS = getNumberEnvVariable('JANITOR_INTERVAL_MS', DEFAULT_JANITOR_INTERVAL_MS);

/**
 * Serialized access to the stream state feed, implemented by SwarmAggregator. The janitor never
 * writes the feed itself: every mutation goes through `commitSerialized`, which runs on the same
 * concurrency-1 queue as the incoming GSOC messages so feed indexes cannot race.
 */
export interface StateFeedAccess {
  readState(): Promise<StateArrayWithTimestamp | null>;
  commitSerialized(
    mutate: (currentState: StateArrayWithTimestamp) => Promise<StateArrayWithTimestamp | null>,
  ): Promise<boolean>;
}

interface ManifestUpdate {
  playlist: string;
  index: number;
}

/**
 * Periodically flips entries whose producer never delivered its live-to-vod update. Such an entry
 * stays state 'live' forever and shows a dead LIVE banner in the clients, while its manifest feed
 * already carries the finalized playlist.
 */
export class LiveJanitor {
  private logger = Logger.getInstance();
  private errorHandler = ErrorHandler.getInstance();
  private timer: NodeJS.Timeout | null = null;
  private isSweeping = false;

  constructor(private readerBee: Bee, private stateManager: StateManager, private stateFeed: StateFeedAccess) {}

  public start(): void {
    if (JANITOR_INTERVAL_MS <= 0) {
      this.logger.info(`[LiveJanitor] Disabled, JANITOR_INTERVAL_MS is ${JANITOR_INTERVAL_MS}`);
      return;
    }

    if (this.timer) {
      this.logger.warn('[LiveJanitor] Already started');
      return;
    }

    this.timer = setInterval(() => void this.sweep(), JANITOR_INTERVAL_MS);
    this.logger.info(`[LiveJanitor] Started, sweeping every ${JANITOR_INTERVAL_MS}ms`);
  }

  public stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
    this.logger.info('[LiveJanitor] Stopped');
  }

  private async sweep(): Promise<void> {
    if (this.isSweeping) {
      this.logger.debug('[LiveJanitor] Previous sweep still running, skipping this one');
      return;
    }

    this.isSweeping = true;

    try {
      const state = await this.stateFeed.readState();
      const liveEntries = (state?.entries || []).filter(entry => entry.state === StateType.LIVE);

      if (liveEntries.length === 0) {
        this.logger.debug('[LiveJanitor] No live entries to inspect');
        return;
      }

      for (const entry of liveEntries) {
        await this.healEntry(entry);
      }
    } catch (error) {
      this.errorHandler.handleError(error, 'LiveJanitor.sweep');
    } finally {
      this.isSweeping = false;
    }
  }

  private async healEntry(entry: StateEntry): Promise<void> {
    const manifest = await this.readManifest(entry);
    if (!manifest) {
      return;
    }

    const update = decideVodUpdate(entry, manifest.playlist, manifest.index);
    if (!update) {
      this.logger.debug(`[LiveJanitor] ${getStreamId(entry)} has no ENDLIST, leaving it live`);
      return;
    }

    const isHealed = await this.stateFeed.commitSerialized(async currentState => {
      const currentEntry = this.stateManager.findEntry(currentState, entry.owner, entry.topic);

      if (!currentEntry || currentEntry.state !== StateType.LIVE) {
        this.logger.debug(`[LiveJanitor] ${getStreamId(entry)} changed before the sweep committed, skipping`);
        return null;
      }

      return this.stateManager.updateEntry(currentState, update);
    });

    if (isHealed) {
      this.logger.info(
        `[LiveJanitor] Healed stale live entry. Title: ${entry.title}, Topic: ${entry.topic}, ` +
          `Index: ${update.index}, Duration: ${update.duration}`,
      );
    }
  }

  private async readManifest(entry: StateEntry): Promise<ManifestUpdate | null> {
    try {
      const feedReader = this.readerBee.feed.makeReader(Topic.fromString(entry.topic), entry.owner);
      const latestUpdate = await feedReader.downloadPayload();

      return {
        playlist: latestUpdate.payload.toUtf8(),
        index: Number(latestUpdate.feedIndex.toBigInt()),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error';
      this.logger.debug(`[LiveJanitor] Manifest unreadable for ${getStreamId(entry)}: ${reason}`);
      return null;
    }
  }
}

function getStreamId(entry: StateEntry): string {
  return `${entry.owner}/${entry.topic}`;
}
