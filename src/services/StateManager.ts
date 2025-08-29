import { Logger } from '../libs/logger.js';
import { StateEntry } from '../types.js';

export class StateManager {
  private logger = Logger.getInstance();
  private readonly maxStateSize = 5;

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
      state = state.slice(1);
    }

    return [...state, entryWithTimestamps];
  }

  public updateEntry(state: StateEntry[], updates: Partial<StateEntry>): StateEntry[] {
    const index = state.findIndex(entry => entry.owner === updates.owner && entry.topic === updates.topic);

    if (index === -1) {
      throw new Error(`Entry not found with id: ${`${updates.owner}:${updates.topic}`}`);
    }

    const updatedEntry = {
      ...state[index],
      ...updates,
      createdAt: state[index].createdAt,
      updatedAt: Date.now(),
    };

    const newState = [...state];
    newState[index] = updatedEntry;

    return newState;
  }

  public deleteEntry(state: StateEntry[], owner: string, topic: string): StateEntry[] {
    const filtered = state.filter(entry => entry.owner === owner && entry.topic === topic);

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
}
