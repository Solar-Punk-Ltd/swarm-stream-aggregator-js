import { describe, expect, it } from 'vitest';

import { encodeStatePayload } from './feedPayload.js';

describe('encodeStatePayload', () => {
  it('measures the payload in bytes, not characters', () => {
    const state = { entries: [{ title: 'Swarm Community Call — August 2026, Viktor Trón' }] };
    const json = JSON.stringify(state);
    const payload = encodeStatePayload(state);

    expect(payload.length).toBeGreaterThan(json.length);
    expect(new TextDecoder().decode(payload)).toBe(json);
  });

  it('round-trips the JSON', () => {
    const state = { entries: [], lastModified: 1 };
    expect(JSON.parse(new TextDecoder().decode(encodeStatePayload(state)))).toEqual(state);
  });
});
