import type { GuardConfig } from '../shared/config';
import { classifyRequest } from './request-classifier';

export type HistoryConfigResolver = () => GuardConfig | null;

function requestFingerprint(args: Parameters<typeof fetch>): string | null {
  const [input, init] = args;
  // Request objects always carry a signal. Conservatively preserve their per-call abort
  // semantics instead of sharing one transport across callers.
  if (input instanceof Request || init?.signal) return null;

  let classification;
  try {
    classification = classifyRequest(input, init);
  } catch {
    return null;
  }
  if (classification.kind === 'other' || classification.method !== 'GET') return null;

  const headers = [...new Headers(init?.headers).entries()].sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({
    method: classification.method,
    url: classification.url.toString(),
    headers,
    credentials: init?.credentials ?? null,
    cache: init?.cache ?? null,
    mode: init?.mode ?? null,
    redirect: init?.redirect ?? null,
    referrer: init?.referrer ?? null,
    referrerPolicy: init?.referrerPolicy ?? null,
    integrity: init?.integrity ?? null,
    keepalive: init?.keepalive ?? null
  });
}

/**
 * Coalesces only truly concurrent, transport-equivalent ChatGPT history GETs.
 * It is deliberately not a cache: the key is removed as soon as the underlying fetch settles.
 */
export function createHistorySingleFlightFetch(
  nativeFetch: typeof fetch,
  resolveConfig: HistoryConfigResolver
): typeof fetch {
  const inFlight = new Map<string, Promise<Response>>();

  return async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const config = resolveConfig();
    if (!config || !config.enabled || config.temporaryFullHistory) return nativeFetch(...args);

    const key = requestFingerprint(args);
    if (!key) return nativeFetch(...args);

    let shared = inFlight.get(key);
    if (!shared) {
      shared = nativeFetch(...args);
      inFlight.set(key, shared);
      const owned = shared;
      void owned.then(
        () => { if (inFlight.get(key) === owned) inFlight.delete(key); },
        () => { if (inFlight.get(key) === owned) inFlight.delete(key); }
      );
    }

    return (await shared).clone();
  };
}
