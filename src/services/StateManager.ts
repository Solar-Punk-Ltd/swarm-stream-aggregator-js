import { Logger } from '../libs/logger.js';
import { StateEntry } from '../types.js';

import { NodeManager } from './NodeManager.js';

export class StateManager {
  private logger = Logger.getInstance();
  private readonly maxStateSize = 5;

  constructor(private nodeManager: NodeManager) {}

  public createEntry(state: StateEntry[], newEntry: StateEntry): StateEntry[] {
    const duplicate = state.find(entry => entry.owner === newEntry.owner && entry.topic === newEntry.topic);

    if (duplicate) {
      throw new Error(`Entry already exists with id: ${`${newEntry.owner}:${newEntry.topic}`}`);
    }

    const entryWithTimestamps = {
      ...newEntry,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (state.length >= this.maxStateSize) {
      this.logger.warn('State size limit reached (5 entries), removing oldest entry');
      const updatedState = this.removeOldestUnpinnedEntry(state);
      return [...updatedState, entryWithTimestamps];
    }

    return [...state, entryWithTimestamps];
  }

  public async updateEntry(state: StateEntry[], updates: Partial<StateEntry>): Promise<StateEntry[]> {
    const index = state.findIndex(entry => entry.owner === updates.owner && entry.topic === updates.topic);

    if (index === -1) {
      throw new Error(`Entry not found with id: ${`${updates.owner}:${updates.topic}`}`);
    }

    if (updates.pinned !== undefined) {
      const streamId = `${updates.owner}/${updates.topic}`;
      this.logger.info(`Toggling pin state for stream ${streamId} to ${updates.pinned ? 'pinned' : 'unpinned'}`);

      try {
        await this.nodeManager.toggleStreamPin(streamId, updates.pinned);
      } catch (error) {
        this.logger.error(`Failed to toggle pin state for stream ${streamId}:`, error);
        throw error;
      }
    }

    const updatedEntry = {
      ...state[index],
      ...updates,
      createdAt: state[index].createdAt,
      updatedAt: Date.now(),
    };

    const newState = [...state];
    newState[index] = updatedEntry;

    return this.sortStateWithPinnedPriority(newState);
  }

  public deleteEntry(state: StateEntry[], owner: string, topic: string): StateEntry[] {
    const filtered = state.filter(entry => !(entry.owner === owner && entry.topic === topic));

    if (filtered.length === state.length) {
      throw new Error(`Entry not found with id: ${`${owner}:${topic}`}`);
    }

    return filtered;
  }

  public findEntry(state: StateEntry[], owner: string, topic: string): StateEntry | undefined {
    return state.find(entry => entry.owner === owner && entry.topic === topic);
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
    for (let i = 0; i < state.length; i++) {
      const entry = state[i];
      const streamId = `${entry.owner}/${entry.topic}`;

      if (!entry.pinned) {
        this.logger.info(`Removing oldest unpinned entry: ${streamId}`);
        return state.filter((_, index) => index !== i);
      } else {
        this.logger.info(`Skipping pinned stream: ${streamId}`);
      }
    }

    const pinnedStreams = state.map(entry => `${entry.owner}/${entry.topic}`).join(', ');
    throw new Error(
      `Cannot add new entry: all ${state.length} existing entries are pinned (${pinnedStreams}). Please unpin some streams or increase the max state size.`,
    );
  }

  private sortStateWithPinnedPriority(state: StateEntry[]): StateEntry[] {
    const pinnedEntries = state.filter(entry => entry.pinned);
    const unpinnedEntries = state.filter(entry => !entry.pinned);

    pinnedEntries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    return [...pinnedEntries, ...unpinnedEntries];
  }
}
