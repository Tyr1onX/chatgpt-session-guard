import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/shared/config';
import { EVENTS, parseStringEvent, type GuardStatsEvent } from '../src/shared/events';
import { createHistorySingleFlightFetch } from '../src/main-world/history-single-flight';

describe('history protection stats events', () => {
  const listeners: EventListener[] = [];

  afterEach(() => {
    for (const listener of listeners) window.removeEventListener(EVENTS.stats, listener);
    listeners.length = 0;
  });

  it('records an opening 429 without requiring successful /c/:id navigation', async () => {
    const emitted: GuardStatsEvent['type'][] = [];
    const listener: EventListener = (event) => {
      const parsed = parseStringEvent<GuardStatsEvent>(event);
      if (parsed) emitted.push(parsed.type);
    };
    listeners.push(listener);
    window.addEventListener(EVENTS.stats, listener);

    const nativeFetch = vi.fn(async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    const guarded = createHistorySingleFlightFetch(nativeFetch, () => DEFAULT_CONFIG);
    const response = await guarded(`${location.origin}/backend-api/conversations/abc?num_turns=4`);

    expect(response.status).toBe(429);
    expect(location.pathname).not.toBe('/c/abc');
    expect(emitted).toContain('session-open-attempt');
    expect(emitted).toContain('failed-open-429');
    expect(emitted).not.toContain('session-open-success');
  });

  it('records successful opens without falsely incrementing failed-open 429', async () => {
    const emitted: GuardStatsEvent['type'][] = [];
    const listener: EventListener = (event) => {
      const parsed = parseStringEvent<GuardStatsEvent>(event);
      if (parsed) emitted.push(parsed.type);
    };
    listeners.push(listener);
    window.addEventListener(EVENTS.stats, listener);

    const nativeFetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const guarded = createHistorySingleFlightFetch(nativeFetch, () => DEFAULT_CONFIG);
    await guarded(`${location.origin}/backend-api/conversations/abc?num_turns=4`);

    expect(emitted).toContain('session-open-attempt');
    expect(emitted).toContain('session-open-success');
    expect(emitted).not.toContain('failed-open-429');
  });
});
