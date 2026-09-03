import type { GuardConfig } from '../shared/config';
import { EVENTS, dispatchStringEvent, type GuardStatsEvent } from '../shared/events';
import { classifyRequest } from './request-classifier';

declare const __CSG_DEBUG_BUILD__: boolean;

export type HistoryConfigResolver = () => GuardConfig | null;
export type HistoryClock = () => number;

const STABILITY_NETWORK_TRACE_EVENT = 'csg:stability-network-trace';
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 1500;
const MIN_RATE_LIMIT_COOLDOWN_MS = 500;
const MAX_RATE_LIMIT_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_ENTRIES = 64;

interface RateLimitCooldown {
  response: Response;
  expiresAt: number;
}

type ProtectionKind = 'single-flight-hit' | 'rate-limit-cooldown-start' | 'rate-limit-cooldown-hit';
type HistoryClassification = NonNullable<ReturnType<typeof classifyHistoryRequest>>;

function classifyHistoryRequest(args: Parameters<typeof fetch>) {
  const [input, init] = args;
  try {
    const classification = classifyRequest(input, init);
    return classification.kind === 'other' ? null : classification;
  } catch {
    return null;
  }
}

function emitStats(type: GuardStatsEvent['type']): void {
  dispatchStringEvent(EVENTS.stats, { type } satisfies GuardStatsEvent);
}

function isSessionOpenRequest(classification: HistoryClassification): boolean {
  return classification.kind === 'legacy-conversation-history' || classification.kind === 'paginated-conversation-history';
}

function emitHistoryRequestStats(classification: HistoryClassification): void {
  emitStats('history-request');
  if (isSessionOpenRequest(classification)) emitStats('session-open-attempt');
}

function emitHistoryResponseStats(classification: HistoryClassification, response: Response): void {
  if (!isSessionOpenRequest(classification)) return;
  if (response.status === 429) emitStats('failed-open-429');
  else if (response.ok) emitStats('session-open-success');
}

function emitProtectionTrace(
  args: Parameters<typeof fetch>,
  protection: ProtectionKind,
  cooldownMs?: number
): void {
  if (!__CSG_DEBUG_BUILD__) return;
  const classification = classifyHistoryRequest(args);
  if (!classification) return;
  dispatchStringEvent(STABILITY_NETWORK_TRACE_EVENT, {
    timestamp: Date.now(),
    type: 'history-protection',
    kind: classification.kind,
    conversationId: classification.conversationId,
    pathname: classification.url.pathname,
    queryKeys: [...classification.url.searchParams.keys()].sort(),
    protection,
    ...(cooldownMs === undefined ? {} : { cooldownMs })
  });
}

function requestFingerprint(args: Parameters<typeof fetch>): string | null {
  const [input, init] = args;
  // Request objects always carry a signal. Conservatively preserve their per-call abort
  // semantics instead of sharing one transport across callers.
  if (input instanceof Request || init?.signal) return null;

  const classification = classifyHistoryRequest(args);
  if (!classification || classification.method !== 'GET') return null;

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

function clampCooldown(value: number): number {
  return Math.min(MAX_RATE_LIMIT_COOLDOWN_MS, Math.max(MIN_RATE_LIMIT_COOLDOWN_MS, value));
}

function rateLimitCooldownMs(response: Response, timestamp: number): number {
  const retryAfter = response.headers.get('retry-after')?.trim();
  if (!retryAfter) return DEFAULT_RATE_LIMIT_COOLDOWN_MS;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return clampCooldown(seconds * 1000);

  const retryAt = Date.parse(retryAfter);
  if (Number.isFinite(retryAt)) return clampCooldown(retryAt - timestamp);
  return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
}

/**
 * Coalesces truly concurrent, transport-equivalent ChatGPT history GETs. Successful responses
 * are never cached. A real HTTP 429 is retained only for a short Retry-After-aware cooldown so
 * staggered app retries cannot immediately hammer the same history endpoint again.
 */
export function createHistorySingleFlightFetch(
  nativeFetch: typeof fetch,
  resolveConfig: HistoryConfigResolver,
  now: HistoryClock = Date.now
): typeof fetch {
  const inFlight = new Map<string, Promise<Response>>();
  const rateLimitCooldowns = new Map<string, RateLimitCooldown>();

  const pruneCooldowns = (timestamp: number): void => {
    for (const [key, cooldown] of rateLimitCooldowns) {
      if (cooldown.expiresAt <= timestamp) rateLimitCooldowns.delete(key);
    }
  };

  const rememberRateLimit = (
    key: string,
    response: Response,
    timestamp: number,
    args: Parameters<typeof fetch>
  ): void => {
    pruneCooldowns(timestamp);
    if (rateLimitCooldowns.size >= MAX_COOLDOWN_ENTRIES && !rateLimitCooldowns.has(key)) {
      const oldestKey = rateLimitCooldowns.keys().next().value as string | undefined;
      if (oldestKey) rateLimitCooldowns.delete(oldestKey);
    }
    const cooldownMs = rateLimitCooldownMs(response, timestamp);
    rateLimitCooldowns.set(key, {
      response,
      expiresAt: timestamp + cooldownMs
    });
    emitProtectionTrace(args, 'rate-limit-cooldown-start', cooldownMs);
    emitStats('rate-limit-cooldown-start');
  };

  return async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const config = resolveConfig();
    if (!config || !config.enabled || config.temporaryFullHistory) {
      // Do not let a previous enabled-mode in-flight/cooldown state leak across an explicit
      // disable or Temporary Full History transition.
      inFlight.clear();
      rateLimitCooldowns.clear();
      return nativeFetch(...args);
    }

    const classification = classifyHistoryRequest(args);
    if (!classification) return nativeFetch(...args);

    const key = requestFingerprint(args);
    if (!key) {
      emitHistoryRequestStats(classification);
      const response = await nativeFetch(...args);
      emitHistoryResponseStats(classification, response);
      return response;
    }

    const timestamp = now();
    pruneCooldowns(timestamp);
    const cooldown = rateLimitCooldowns.get(key);
    if (cooldown && cooldown.expiresAt > timestamp) {
      emitProtectionTrace(args, 'rate-limit-cooldown-hit', cooldown.expiresAt - timestamp);
      emitStats('rate-limit-cooldown-hit');
      return cooldown.response.clone();
    }

    let shared = inFlight.get(key);
    if (shared) {
      emitProtectionTrace(args, 'single-flight-hit');
      emitStats('single-flight-hit');
    } else {
      emitHistoryRequestStats(classification);
      shared = nativeFetch(...args);
      inFlight.set(key, shared);
      const owned = shared;
      void owned.then(
        (response) => {
          if (inFlight.get(key) === owned) inFlight.delete(key);
          emitHistoryResponseStats(classification, response);
          if (response.status === 429) rememberRateLimit(key, response, now(), args);
          else rateLimitCooldowns.delete(key);
        },
        () => { if (inFlight.get(key) === owned) inFlight.delete(key); }
      );
    }

    return (await shared).clone();
  };
}
