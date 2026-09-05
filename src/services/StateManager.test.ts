import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaType, StateArrayWithTimestamp, StateEntry, StateType } from '../types.js';

import { NodeManager } from './NodeManager.js';
import { StateManager } from './StateManager.js';

const nodeManager = { toggleStreamPin: vi.fn() } as unknown as NodeManager;

function buildEntry(topic: string, overrides: Partial<StateEntry> = {}): StateEntry {
  return {
    owner: '0xf9e7d6c5b4a39281706152433425364758697081',
    topic,
    title: `Stream ${topic}`,
    state: StateType.VOD,
    mediaType: MediaType.VIDEO,
    createdAt: 1_756_200_000_000,
    updatedAt: 1_756_200_000_000,
    ...overrides,
  };
}

function buildState(entries: StateEntry[]): StateArrayWithTimestamp {
  return { entries, lastModified: 1_756_200_000_000 };
}

const topicsOf = (state: StateArrayWithTimestamp) => state.entries.map(entry => entry.topic);

describe('StateManager entry limit', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('holds ten non-external entries before evicting anything', () => {
    const stateManager = new StateManager(nodeManager);
    const existing = Array.from({ length: 9 }, (_, i) => buildEntry(`s${i}`, { updatedAt: 1_000 + i }));

    const result = stateManager.createEntry(buildState(existing), buildEntry('new'));

    expect(result.entries).toHaveLength(10);
    expect(topicsOf(result)).toContain('s0');
  });

  it('evicts the oldest unpinned non-external entry once full', () => {
    const stateManager = new StateManager(nodeManager);
    const existing = Array.from({ length: 10 }, (_, i) => buildEntry(`s${i}`, { updatedAt: 1_000 + i }));

    const result = stateManager.createEntry(buildState(existing), buildEntry('new'));

    expect(result.entries).toHaveLength(10);
    expect(topicsOf(result)).not.toContain('s0');
    expect(topicsOf(result)).toContain('new');
  });

  it('never evicts external entries and does not count them towards the limit', () => {
    const stateManager = new StateManager(nodeManager);
    const existing = [
      ...Array.from({ length: 10 }, (_, i) => buildEntry(`s${i}`, { updatedAt: 1_000 + i })),
      buildEntry('ext', { isExternal: true, updatedAt: 1 }),
    ];

    const result = stateManager.createEntry(buildState(existing), buildEntry('new'));

    expect(topicsOf(result)).toContain('ext');
    expect(topicsOf(result)).not.toContain('s0');
    expect(result.entries.filter(entry => !entry.isExternal)).toHaveLength(10);
  });

  it('reads the limit from MAX_STATE_SIZE', () => {
    vi.stubEnv('MAX_STATE_SIZE', '3');
    const stateManager = new StateManager(nodeManager);
    const existing = Array.from({ length: 3 }, (_, i) => buildEntry(`s${i}`, { updatedAt: 1_000 + i }));

    const result = stateManager.createEntry(buildState(existing), buildEntry('new'));

    expect(result.entries).toHaveLength(3);
    expect(topicsOf(result)).not.toContain('s0');
  });
});
