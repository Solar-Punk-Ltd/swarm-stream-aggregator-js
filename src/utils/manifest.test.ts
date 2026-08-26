import { describe, expect, it } from 'vitest';

import { MediaType, StateEntry, StateType } from '../types.js';

import { decideVodUpdate, hasEndlistMarker, sumSegmentDurations } from './manifest.js';

const ENDLIST_TAG = '#EXT-X-ENDLIST';

// The two streams that stayed stuck on 'live' during the 2026-08-26 incident: their manifest
// feeds were finalized at index 975 (975 segments) and index 29 (29 segments).
const LONG_STREAM_SEGMENTS = [...new Array<number>(974).fill(7.07), 7.786];
const LONG_STREAM_DURATION = 6893.966;
const LONG_STREAM_INDEX = 975;

const SHORT_STREAM_SEGMENTS = [...new Array<number>(28).fill(8.333), 8.343];
const SHORT_STREAM_DURATION = 241.667;
const SHORT_STREAM_INDEX = 29;

const NODE_INFO = { port: 1633, stampHash: `0x${'a'.repeat(64)}` };

function buildEntry(overrides: Partial<StateEntry> = {}): StateEntry {
  return {
    owner: '0xf9e7d6c5b4a39281706152433425364758697081',
    topic: 'incident-stream',
    title: 'Incident stream',
    state: StateType.LIVE,
    mediaType: MediaType.VIDEO,
    createdAt: 1_756_200_000_000,
    updatedAt: 1_756_200_000_000,
    nodes: { media: NODE_INFO, chat: NODE_INFO },
    ...overrides,
  };
}

function buildPlaylist(durations: number[], isFinalized: boolean): string {
  const header = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:9', '#EXT-X-MEDIA-SEQUENCE:0'];
  const segments = durations.flatMap((seconds, position) => [
    `#EXTINF:${seconds.toFixed(3)},`,
    `segment-${position}.ts`,
  ]);
  const trailer = isFinalized ? [ENDLIST_TAG] : [];

  return [...header, ...segments, ...trailer].join('\n');
}

describe('hasEndlistMarker', () => {
  it('detects the endlist tag in a finalized playlist', () => {
    const playlist = buildPlaylist(SHORT_STREAM_SEGMENTS, true);

    expect(hasEndlistMarker(playlist)).toBe(true);
  });

  it('reports no endlist tag for a playlist that is still growing', () => {
    const playlist = buildPlaylist(SHORT_STREAM_SEGMENTS, false);

    expect(hasEndlistMarker(playlist)).toBe(false);
  });

  it('tolerates carriage returns and a trailing newline', () => {
    const playlist = `#EXTM3U\r\n#EXTINF:8.333,\r\nsegment-0.ts\r\n${ENDLIST_TAG}\r\n`;

    expect(hasEndlistMarker(playlist)).toBe(true);
  });

  it('ignores a segment uri that merely contains the endlist text', () => {
    const playlist = ['#EXTM3U', '#EXTINF:8.333,', 'not-a-real-EXT-X-ENDLIST-segment.ts'].join('\n');

    expect(hasEndlistMarker(playlist)).toBe(false);
  });

  it('reports no endlist tag for an empty playlist', () => {
    expect(hasEndlistMarker('')).toBe(false);
  });
});

describe('sumSegmentDurations', () => {
  it('sums the 975 segments of the long finalized manifest', () => {
    const playlist = buildPlaylist(LONG_STREAM_SEGMENTS, true);

    expect(sumSegmentDurations(playlist)).toBe(LONG_STREAM_DURATION);
  });

  it('sums the 29 segments of the short finalized manifest', () => {
    const playlist = buildPlaylist(SHORT_STREAM_SEGMENTS, true);

    expect(sumSegmentDurations(playlist)).toBe(SHORT_STREAM_DURATION);
  });

  it('reads the duration from an EXTINF line that carries a segment title', () => {
    const playlist = ['#EXTM3U', '#EXTINF:8.333,segment title', 'segment-0.ts'].join('\n');

    expect(sumSegmentDurations(playlist)).toBe(8.333);
  });

  it('returns zero for a playlist without segments', () => {
    const playlist = ['#EXTM3U', '#EXT-X-VERSION:3', ENDLIST_TAG].join('\n');

    expect(sumSegmentDurations(playlist)).toBe(0);
  });

  it('skips EXTINF lines with a missing or unparseable duration', () => {
    const playlist = [
      '#EXTM3U',
      '#EXTINF:,',
      'segment-0.ts',
      '#EXTINF:not-a-number,',
      'segment-1.ts',
      '#EXTINF',
      '#EXTINF:8.333,',
      'segment-2.ts',
    ].join('\n');

    expect(sumSegmentDurations(playlist)).toBe(8.333);
  });

  it('returns zero for input that is not a playlist at all', () => {
    expect(sumSegmentDurations('<html><body>404 not found</body></html>')).toBe(0);
  });
});

describe('decideVodUpdate', () => {
  it('turns a live entry with a finalized manifest into a vod payload', () => {
    const entry = buildEntry();
    const playlist = buildPlaylist(LONG_STREAM_SEGMENTS, true);

    const update = decideVodUpdate(entry, playlist, LONG_STREAM_INDEX);

    expect(update).toEqual({
      owner: entry.owner,
      topic: entry.topic,
      state: StateType.VOD,
      index: LONG_STREAM_INDEX,
      duration: LONG_STREAM_DURATION,
    });
  });

  it('carries no field other than the identity and the vod result', () => {
    const entry = buildEntry({ thumbnail: 'swarm-reference', description: 'a description', pinned: true });
    const playlist = buildPlaylist(SHORT_STREAM_SEGMENTS, true);

    const update = decideVodUpdate(entry, playlist, SHORT_STREAM_INDEX);

    expect(Object.keys(update!).sort()).toEqual(['duration', 'index', 'owner', 'state', 'topic']);
    expect(update).toMatchObject({ index: SHORT_STREAM_INDEX, duration: SHORT_STREAM_DURATION });
  });

  it('leaves a genuinely live entry alone while its manifest has no endlist', () => {
    const entry = buildEntry();
    const playlist = buildPlaylist(LONG_STREAM_SEGMENTS, false);

    expect(decideVodUpdate(entry, playlist, LONG_STREAM_INDEX)).toBeNull();
  });

  it('leaves an entry that is already a vod alone', () => {
    const entry = buildEntry({ state: StateType.VOD, index: SHORT_STREAM_INDEX });
    const playlist = buildPlaylist(SHORT_STREAM_SEGMENTS, true);

    expect(decideVodUpdate(entry, playlist, SHORT_STREAM_INDEX)).toBeNull();
  });

  it('leaves a scheduled entry alone', () => {
    const entry = buildEntry({ state: StateType.SCHEDULED });
    const playlist = buildPlaylist(SHORT_STREAM_SEGMENTS, true);

    expect(decideVodUpdate(entry, playlist, SHORT_STREAM_INDEX)).toBeNull();
  });

  it('heals an external entry on the same terms as any other', () => {
    const entry = buildEntry({ isExternal: true });
    const playlist = buildPlaylist(SHORT_STREAM_SEGMENTS, true);

    expect(decideVodUpdate(entry, playlist, SHORT_STREAM_INDEX)).toMatchObject({
      state: StateType.VOD,
      index: SHORT_STREAM_INDEX,
      duration: SHORT_STREAM_DURATION,
    });
  });

  it('leaves the entry alone when the manifest could not be parsed as a playlist', () => {
    const entry = buildEntry();

    expect(decideVodUpdate(entry, '<html><body>404 not found</body></html>', LONG_STREAM_INDEX)).toBeNull();
    expect(decideVodUpdate(entry, '', LONG_STREAM_INDEX)).toBeNull();
  });

  it('still flips a finalized manifest whose segment durations are unreadable', () => {
    const entry = buildEntry();
    const playlist = ['#EXTM3U', '#EXTINF:not-a-number,', 'segment-0.ts', ENDLIST_TAG].join('\n');

    expect(decideVodUpdate(entry, playlist, SHORT_STREAM_INDEX)).toMatchObject({
      state: StateType.VOD,
      duration: 0,
    });
  });
});
