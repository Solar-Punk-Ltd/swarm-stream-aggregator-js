import { ErrorHandler } from '../libs/error.js';
import { Logger } from '../libs/logger.js';
import { StateArrayWithTimestamp, StateEntry } from '../types.js';
import { getNumberEnvVariable, matchesEntry } from '../utils/common.js';

import { NodeManager } from './NodeManager.js';

/**
 * How many non-external entries the published list carries. External entries are exempt, so the
 * list holds this many real streams plus however many evergreen external ones are configured.
 *
 * The whole list is written as one feed payload. Above 4096 bytes bee-js stores it as a wrapped
 * chunk and Bee rejoins it on read, so this is a product decision about list length rather than a
 * transport limit.
 */
const DEFAULT_MAX_STATE_SIZE = 10;

export class StateManager {
  private logger = Logger.getInstance();
  private errorHandler = ErrorHandler.getInstance();
  private readonly maxStateSize = getNumberEnvVariable('MAX_STATE_SIZE', DEFAULT_MAX_STATE_SIZE);

  constructor(private nodeManager: NodeManager) {}

  public createEntry(state: StateArrayWithTimestamp, newEntry: StateEntry): StateArrayWithTimestamp {
    const entries = state.entries;
    const duplicate = entries.find(entry => matchesEntry(entry, newEntry.owner, newEntry.topic));

    if (duplicate) {
      throw new Error(`Entry already exists with id: ${`${newEntry.owner}:${newEntry.topic}`}`);
    }

    const entryWithTimestamps = {
      ...newEntry,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (newEntry.isExternal) {
      this.logger.info(`Adding external entry: ${newEntry.owner}/${newEntry.topic} (bypassing size limit)`);
      return this.createStateArrayWithTimestamp(this.sortStateWithPinnedPriority([...entries, entryWithTimestamps]));
    }

    const nonExternalEntries = entries.filter(entry => !entry.isExternal);
    if (nonExternalEntries.length >= this.maxStateSize) {
      this.logger.warn(
        `Non-external entry limit reached (${this.maxStateSize} entries), removing oldest unpinned non-external entry`,
      );
      const updatedState = this.removeOldestUnpinnedEntry(entries);

      return this.createStateArrayWithTimestamp(
        this.sortStateWithPinnedPriority([...updatedState, entryWithTimestamps]),
      );
    }

    return this.createStateArrayWithTimestamp(this.sortStateWithPinnedPriority([...entries, entryWithTimestamps]));
  }

  public async updateEntry(
    state: StateArrayWithTimestamp,
    updates: Partial<StateEntry>,
  ): Promise<StateArrayWithTimestamp> {
    const entries = state.entries;
    const index = entries.findIndex(entry => matchesEntry(entry, updates.owner!, updates.topic!));

    if (index === -1) {
      throw new Error(`Entry not found with id: ${`${updates.owner}:${updates.topic}`}`);
    }

    if (updates.pinned !== undefined) {
      const streamId = `${updates.owner}/${updates.topic}`;
      this.logger.info(`Toggling pin state for stream ${streamId} to ${updates.pinned ? 'pinned' : 'unpinned'}`);

      try {
        await this.nodeManager.toggleStreamPin(streamId, updates.pinned);
      } catch (error) {
        this.errorHandler.handleError(error, `StateManager.updateEntry.togglePin[${streamId}]`);
        throw error;
      }
    }

    const updatedEntry = {
      ...entries[index],
      ...updates,
      createdAt: entries[index].createdAt,
      updatedAt: Date.now(),
    };

    const newState = [...entries];
    newState[index] = updatedEntry;

    return this.createStateArrayWithTimestamp(this.sortStateWithPinnedPriority(newState));
  }

  public async deleteEntry(
    state: StateArrayWithTimestamp,
    owner: string,
    topic: string,
  ): Promise<StateArrayWithTimestamp> {
    const entries = state.entries;
    const entryToDelete = entries.find(entry => matchesEntry(entry, owner, topic));

    if (!entryToDelete) {
      throw new Error(`Entry not found with id: ${`${owner}:${topic}`}`);
    }

    const streamId = `${owner}/${topic}`;

    if (entryToDelete.pinned) {
      this.logger.info(`Deleting entry ${streamId} - unpinning first`);
      try {
        await this.nodeManager.toggleStreamPin(streamId, false);
      } catch (error) {
        this.errorHandler.handleError(error, `StateManager.deleteEntry.unpinNodes[${streamId}]`);
        throw error;
      }
    } else {
      this.logger.info(`Deleting entry ${streamId}`);
    }

    const filtered = entries.filter(entry => !matchesEntry(entry, owner, topic));
    return this.createStateArrayWithTimestamp(filtered);
  }

  public findEntry(state: StateArrayWithTimestamp, owner: string, topic: string): StateEntry | undefined {
    const entries = state.entries;
    return entries.find(entry => matchesEntry(entry, owner, topic));
  }

  public validateEntry(entry: StateEntry): boolean {
    if (!entry.owner || !entry.topic) {
      this.logger.error('Invalid entry: missing required fields (id or owner/topic)');
      return false;
    }

    //TODO: Add more validation rules
    return true;
  }

  private removeOldestUnpinnedEntry(state: StateEntry[]): StateEntry[] {
    const unpinnedNonExternalEntries = state.filter(entry => !entry.pinned && !entry.isExternal);

    if (unpinnedNonExternalEntries.length === 0) {
      const pinnedStreams = state
        .filter(entry => entry.pinned)
        .map(entry => `${entry.owner}/${entry.topic}`)
        .join(', ');
      const externalStreams = state
        .filter(entry => entry.isExternal)
        .map(entry => `${entry.owner}/${entry.topic}`)
        .join(', ');

      throw new Error(
        `Cannot add new entry: no unpinned non-external entries available for removal. ` +
          `Pinned: [${pinnedStreams}], External: [${externalStreams}]. ` +
          `Please unpin some streams or increase the max state size.`,
      );
    }

    const oldestUnpinned = unpinnedNonExternalEntries.reduce((oldest, current) => {
      const oldestTime = oldest.updatedAt || oldest.createdAt || 0;
      const currentTime = current.updatedAt || current.createdAt || 0;
      return currentTime < oldestTime ? current : oldest;
    });

    const streamId = `${oldestUnpinned.owner}/${oldestUnpinned.topic}`;
    this.logger.info(`Removing oldest unpinned non-external entry: ${streamId}`);

    return state.filter(entry => !matchesEntry(entry, oldestUnpinned.owner, oldestUnpinned.topic));
  }

  private sortStateWithPinnedPriority(state: StateEntry[]): StateEntry[] {
    const pinnedEntries = state.filter(entry => entry.pinned);
    const unpinnedEntries = state.filter(entry => !entry.pinned);

    const sortByExternalAndUpdatedAt = (a: StateEntry, b: StateEntry) => {
      if (a.isExternal !== b.isExternal) {
        return a.isExternal ? 1 : -1;
      }
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    };

    pinnedEntries.sort(sortByExternalAndUpdatedAt);
    unpinnedEntries.sort(sortByExternalAndUpdatedAt);

    return [...pinnedEntries, ...unpinnedEntries];
  }

  public createStateArrayWithTimestamp(entries: StateEntry[]): StateArrayWithTimestamp {
    return {
      entries,
      lastModified: Date.now(),
    };
  }
}
