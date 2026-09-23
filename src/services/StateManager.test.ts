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

  const fullRollingList = () => Array.from({ length: 10 }, (_, i) => buildEntry(`s${i}`, { updatedAt: 1_000 + i }));

  it('accepts a new entry while a rolling place is free', () => {
    const stateManager = new StateManager(nodeManager);
    const existing = Array.from({ length: 9 }, (_, i) => buildEntry(`s${i}`, { updatedAt: 1_000 + i }));

    const result = stateManager.createEntry(buildState(existing), buildEntry('new'));

    expect(result.entries).toHaveLength(10);
    expect(topicsOf(result)).toContain('s0');
    expect(topicsOf(result)).toContain('new');
  });

  it('refuses a new entry once every rolling place is taken, and removes nothing', () => {
    const stateManager = new StateManager(nodeManager);
    const state = buildState(fullRollingList());

    expect(() => stateManager.createEntry(state, buildEntry('new'))).toThrow(/stream list is full/i);
    expect(topicsOf(state)).toEqual(fullRollingList().map(entry => entry.topic));
  });

  it('never pushes out a scheduled event to make room', () => {
    const stateManager = new StateManager(nodeManager);
    const existing = [
      buildEntry('scheduled-call', { state: StateType.SCHEDULED, updatedAt: 1 }),
      ...Array.from({ length: 9 }, (_, i) => buildEntry(`s${i}`, { updatedAt: 1_000 + i })),
    ];
    const state = buildState(existing);

    expect(() => stateManager.createEntry(state, buildEntry('new'))).toThrow(/stream list is full/i);
    expect(topicsOf(state)).toContain('scheduled-call');
  });

  it('still accepts an archived (external) entry when the rolling places are full', () => {
    const stateManager = new StateManager(nodeManager);

    const result = stateManager.createEntry(buildState(fullRollingList()), buildEntry('ext', { isExternal: true }));

    expect(topicsOf(result)).toContain('ext');
    expect(result.entries.filter(entry => !entry.isExternal)).toHaveLength(10);
  });

  it('does not count archived (external) entries towards the limit', () => {
    const stateManager = new StateManager(nodeManager);
    const existing = [
      ...Array.from({ length: 9 }, (_, i) => buildEntry(`s${i}`, { updatedAt: 1_000 + i })),
      ...Array.from({ length: 5 }, (_, i) => buildEntry(`ext${i}`, { isExternal: true, updatedAt: 1 })),
    ];

    const result = stateManager.createEntry(buildState(existing), buildEntry('new'));

    expect(topicsOf(result)).toContain('new');
    expect(result.entries).toHaveLength(15);
  });

  it('reads the limit from MAX_STATE_SIZE', () => {
    vi.stubEnv('MAX_STATE_SIZE', '3');
    const stateManager = new StateManager(nodeManager);
    const existing = Array.from({ length: 3 }, (_, i) => buildEntry(`s${i}`, { updatedAt: 1_000 + i }));

    expect(() => stateManager.createEntry(buildState(existing), buildEntry('new'))).toThrow(/all 3 rolling places/i);
  });
});

describe('StateManager timestamps on create', () => {
  it('stamps now when the entry carries no timestamps', () => {
    const stateManager = new StateManager(nodeManager);
    const { createdAt: _c, updatedAt: _u, ...fresh } = buildEntry('fresh');
    const before = Date.now();

    const result = stateManager.createEntry(buildState([]), fresh as StateEntry);

    const entry = result.entries[0];
    expect(entry.createdAt).toBeGreaterThanOrEqual(before);
    expect(entry.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('keeps supplied timestamps so a restored entry is not reported as new', () => {
    const stateManager = new StateManager(nodeManager);
    const restored = buildEntry('restored', { createdAt: 1_781_703_535_591, updatedAt: 1_781_766_190_226 });

    const result = stateManager.createEntry(buildState([]), restored);

    expect(result.entries[0].createdAt).toBe(1_781_703_535_591);
    expect(result.entries[0].updatedAt).toBe(1_781_766_190_226);
  });
});
