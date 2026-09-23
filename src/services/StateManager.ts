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

    // Clients never send timestamps, so a supplied pair means a deliberate restore of an entry that
    // was evicted, and it keeps its place in the history instead of surfacing as new.
    const now = Date.now();
    const entryWithTimestamps = {
      ...newEntry,
      createdAt: newEntry.createdAt ?? now,
      updatedAt: newEntry.updatedAt ?? now,
    };

    if (newEntry.isExternal) {
      this.logger.info(`Adding external entry: ${newEntry.owner}/${newEntry.topic} (bypassing size limit)`);
      return this.createStateArrayWithTimestamp(this.sortStateWithPinnedPriority([...entries, entryWithTimestamps]));
    }

    // A full list refuses rather than pushing an older entry out, because eviction cannot tell a finished
    // test from a scheduled event and removes either one without telling anybody.
    const rollingEntries = entries.filter(entry => !entry.isExternal);
    if (rollingEntries.length >= this.maxStateSize) {
      throw new Error(
        `Stream list is full: all ${this.maxStateSize} rolling places are taken, refusing ` +
          `${newEntry.owner}/${newEntry.topic}. Delete or archive a stream to free a place.`,
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
