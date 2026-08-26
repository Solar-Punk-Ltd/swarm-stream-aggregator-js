import { StateEntry, StateType } from '../types.js';

/**
 * HLS tag that marks a playlist as complete (RFC 8216 §4.3.3.4). A live playlist never carries
 * it, a finalized one always does, so it is the only definitive "the stream is over" signal
 * available to a reader.
 */
const ENDLIST_TAG = '#EXT-X-ENDLIST';

/** Per-segment duration tag, formatted as `#EXTINF:<seconds>,<optional title>`. */
const SEGMENT_DURATION_TAG = '#EXTINF:';

/** Segment durations are floats, so the accumulated total is rounded back to millisecond precision. */
const DURATION_DECIMAL_PLACES = 3;

export function hasEndlistMarker(playlist: string): boolean {
  return toLines(playlist).some(line => line === ENDLIST_TAG);
}

export function sumSegmentDurations(playlist: string): number {
  const total = toLines(playlist).reduce((sum, line) => {
    const seconds = parseSegmentDuration(line);
    return seconds === null ? sum : sum + seconds;
  }, 0);

  return roundSeconds(total);
}

/**
 * Builds the update payload that turns a finished live entry into a vod, or null when the entry
 * must be left untouched. The payload carries the same fields an update message would, so it can
 * be handed to StateManager.updateEntry unchanged.
 */
export function decideVodUpdate(
  entry: StateEntry,
  playlist: string,
  manifestIndex: number,
): Partial<StateEntry> | null {
  if (entry.state !== StateType.LIVE) {
    return null;
  }

  if (!hasEndlistMarker(playlist)) {
    return null;
  }

  return {
    owner: entry.owner,
    topic: entry.topic,
    state: StateType.VOD,
    index: manifestIndex,
    duration: sumSegmentDurations(playlist),
  };
}

function toLines(playlist: string): string[] {
  return playlist.split('\n').map(line => line.trim());
}

function parseSegmentDuration(line: string): number | null {
  if (!line.startsWith(SEGMENT_DURATION_TAG)) {
    return null;
  }

  const [seconds] = line.slice(SEGMENT_DURATION_TAG.length).split(',');
  const parsed = Number.parseFloat(seconds);

  return Number.isFinite(parsed) ? parsed : null;
}

function roundSeconds(seconds: number): number {
  const factor = 10 ** DURATION_DECIMAL_PLACES;
  return Math.round(seconds * factor) / factor;
}
