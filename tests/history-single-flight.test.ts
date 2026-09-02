import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/shared/config';
import { createHistorySingleFlightFetch } from '../src/main-world/history-single-flight';

function deferredResponse(): {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
} {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('history single-flight', () => {
  it('coalesces concurrent identical history GETs and returns independent clones', async () => {
    const pending = deferredResponse();
    const nativeFetch = vi.fn(() => pending.promise) as unknown as typeof fetch;
    const guarded = createHistorySingleFlightFetch(nativeFetch, () => DEFAULT_CONFIG);
    const url = `${location.origin}/backend-api/conversations/abc?num_turns=4`;

    const first = guarded(url);
    const second = guarded(url);
    expect(nativeFetch).toHaveBeenCalledTimes(1);

    pending.resolve(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));

    const [a, b] = await Promise.all([first, second]);
    expect(a).not.toBe(b);
    expect(await a.json()).toEqual({ ok: true });
    expect(await b.json()).toEqual({ ok: true });
  });

  it('collapses a 100-request hydration burst into one network request', async () => {
    const pending = deferredResponse();
    const nativeFetch = vi.fn(() => pending.promise) as unknown as typeof fetch;
    const guarded = createHistorySingleFlightFetch(nativeFetch, () => DEFAULT_CONFIG);
    const url = `${location.origin}/backend-api/conversations/abc?num_turns=4`;

    const requests = Array.from({ length: 100 }, () => guarded(url));
    expect(nativeFetch).toHaveBeenCalledTimes(1);

    pending.resolve(new Response(JSON.stringify({ messages: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    const responses = await Promise.all(requests);
    expect(responses).toHaveLength(100);
    expect(await responses[0]?.json()).toEqual({ messages: [] });
    expect(await responses[99]?.json()).toEqual({ messages: [] });
  });

  it('reuses a real 429 during Retry-After cooldown instead of hitting the network again', async () => {
    let timestamp = 1000;
    const nativeFetch = vi.fn(async () => new Response('rate limited', {
      status: 429,
      headers: { 'retry-after': '2' }
    })) as unknown as typeof fetch;
    const guarded = createHistorySingleFlightFetch(nativeFetch, () => DEFAULT_CONFIG, () => timestamp);
    const url = `${location.origin}/backend-api/conversations/abc?num_turns=4`;

    const first = await guarded(url);
    expect(first.status).toBe(429);
    expect(nativeFetch).toHaveBeenCalledTimes(1);

    timestamp = 2500;
    const duringCooldown = await guarded(url);
    expect(duringCooldown.status).toBe(429);
    expect(await duringCooldown.text()).toBe('rate limited');
    expect(nativeFetch).toHaveBeenCalledTimes(1);

    timestamp = 3001;
    const afterCooldown = await guarded(url);
    expect(afterCooldown.status).toBe(429);
    expect(nativeFetch).toHaveBeenCalledTimes(2);
  });

  it('clears prior 429 cooldown state when the guard is explicitly bypassed', async () => {
    let config = DEFAULT_CONFIG;
    let timestamp = 1000;
    const nativeFetch = vi.fn(async () => new Response('rate limited', {
      status: 429,
      headers: { 'retry-after': '30' }
    })) as unknown as typeof fetch;
    const guarded = createHistorySingleFlightFetch(nativeFetch, () => config, () => timestamp);
    const url = `${location.origin}/backend-api/conversations/abc?num_turns=4`;

    await guarded(url);
    expect(nativeFetch).toHaveBeenCalledTimes(1);

    config = normalizeConfig({ ...DEFAULT_CONFIG, enabled: false });
    await guarded(url);
    expect(nativeFetch).toHaveBeenCalledTimes(2);

    config = DEFAULT_CONFIG;
    timestamp = 1100;
    await guarded(url);
    expect(nativeFetch).toHaveBeenCalledTimes(3);
  });

  it('does not cache after the underlying successful request settles', async () => {
    const nativeFetch = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    const guarded = createHistorySingleFlightFetch(nativeFetch, () => DEFAULT_CONFIG);
    const url = `${location.origin}/backend-api/conversations/abc?num_turns=4`;

    await guarded(url);
    await Promise.resolve();
    await guarded(url);
    expect(nativeFetch).toHaveBeenCalledTimes(2);
  });

  it('does not coalesce when the guard is disabled or Temporary Full History is active', async () => {
    const nativeFetch = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    const disabled = normalizeConfig({ ...DEFAULT_CONFIG, enabled: false });
    const full = normalizeConfig({ ...DEFAULT_CONFIG, temporaryFullHistory: true });
    const url = `${location.origin}/backend-api/conversations/abc?num_turns=4`;

    const disabledFetch = createHistorySingleFlightFetch(nativeFetch, () => disabled);
    await Promise.all([disabledFetch(url), disabledFetch(url)]);
    expect(nativeFetch).toHaveBeenCalledTimes(2);

    vi.mocked(nativeFetch).mockClear();
    const fullFetch = createHistorySingleFlightFetch(nativeFetch, () => full);
    await Promise.all([fullFetch(url), fullFetch(url)]);
    expect(nativeFetch).toHaveBeenCalledTimes(2);
  });

  it('preserves explicit abort semantics by skipping coalescing', async () => {
    const pending = deferredResponse();
    const nativeFetch = vi.fn(() => pending.promise) as unknown as typeof fetch;
    const guarded = createHistorySingleFlightFetch(nativeFetch, () => DEFAULT_CONFIG);
    const controller = new AbortController();
    const url = `${location.origin}/backend-api/conversations/abc?num_turns=4`;

    const first = guarded(url, { signal: controller.signal });
    const second = guarded(url, { signal: controller.signal });
    expect(nativeFetch).toHaveBeenCalledTimes(2);

    pending.resolve(new Response('{}'));
    await Promise.all([first, second]);
  });

  it('does not coalesce non-history GETs', async () => {
    const pending = deferredResponse();
    const nativeFetch = vi.fn(() => pending.promise) as unknown as typeof fetch;
    const guarded = createHistorySingleFlightFetch(nativeFetch, () => DEFAULT_CONFIG);
    const url = `${location.origin}/backend-api/models`;

    const first = guarded(url);
    const second = guarded(url);
    expect(nativeFetch).toHaveBeenCalledTimes(2);

    pending.resolve(new Response('{}'));
    await Promise.all([first, second]);
  });
});
