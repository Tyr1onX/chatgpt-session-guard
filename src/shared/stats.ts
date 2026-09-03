export const STATS_STORAGE_KEY = 'csg.stats.v1';
export const STATS_VERSION = 1 as const;
const MAX_SWITCH_LATENCY_SAMPLES = 200;

export interface GuardStats {
  statsVersion: typeof STATS_VERSION;
  buildId: string;
  firstSeenAt: number;
  lastUpdatedAt: number;
  guardStartedAt: number;
  sessionOpenAttemptCount: number;
  sessionOpenSuccessCount: number;
  failedOpen429Count: number;
  historyRequestCount: number;
  singleFlightHitCount: number;
  olderPageSuppressedCount: number;
  rateLimitCooldownStartCount: number;
  rateLimitCooldownHitCount: number;
  spaSwitchCount: number;
  windowFlappingDetectedCount: number;
  switchLatencySamples: number[];
  switchLatencyP50: number | null;
  switchLatencyP95: number | null;
  maxActiveConversationDomNodes: number;
  maxDocumentDomNodes: number;
}

export interface GuardStatsDelta {
  sessionOpenAttemptCount?: number;
  sessionOpenSuccessCount?: number;
  failedOpen429Count?: number;
  historyRequestCount?: number;
  singleFlightHitCount?: number;
  olderPageSuppressedCount?: number;
  rateLimitCooldownStartCount?: number;
  rateLimitCooldownHitCount?: number;
  spaSwitchCount?: number;
  windowFlappingDetectedCount?: number;
  switchLatencySamples?: number[];
  maxActiveConversationDomNodes?: number;
  maxDocumentDomNodes?: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function validTimestamp(value: unknown, fallback: number, now: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= now + 60_000
    ? value
    : fallback;
}

function sanitizedSamples(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(nonNegativeNumber)
    .filter((sample): sample is number => sample !== null)
    .slice(-MAX_SWITCH_LATENCY_SAMPLES);
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  const value = sorted[index];
  return value === undefined ? null : Math.round(value * 10) / 10;
}

function withPercentiles(stats: Omit<GuardStats, 'switchLatencyP50' | 'switchLatencyP95'>): GuardStats {
  return {
    ...stats,
    switchLatencyP50: percentile(stats.switchLatencySamples, 0.5),
    switchLatencyP95: percentile(stats.switchLatencySamples, 0.95)
  };
}

export function createDefaultStats(buildId: string, now = Date.now()): GuardStats {
  return withPercentiles({
    statsVersion: STATS_VERSION,
    buildId,
    firstSeenAt: now,
    lastUpdatedAt: now,
    guardStartedAt: now,
    sessionOpenAttemptCount: 0,
    sessionOpenSuccessCount: 0,
    failedOpen429Count: 0,
    historyRequestCount: 0,
    singleFlightHitCount: 0,
    olderPageSuppressedCount: 0,
    rateLimitCooldownStartCount: 0,
    rateLimitCooldownHitCount: 0,
    spaSwitchCount: 0,
    windowFlappingDetectedCount: 0,
    switchLatencySamples: [],
    maxActiveConversationDomNodes: 0,
    maxDocumentDomNodes: 0
  });
}

/**
 * Repairs corrupted local data and migrates older object-shaped stats into schema v1.
 * Unknown keys are intentionally discarded so no conversation data can leak into stats.
 */
export function normalizeStats(value: unknown, buildId: string, now = Date.now()): GuardStats {
  const source = record(value);
  if (!source) return createDefaultStats(buildId, now);

  const firstSeenAt = validTimestamp(source.firstSeenAt, now, now);
  const guardStartedAt = validTimestamp(source.guardStartedAt, firstSeenAt, now);
  const samples = sanitizedSamples(source.switchLatencySamples);
  return withPercentiles({
    statsVersion: STATS_VERSION,
    buildId,
    firstSeenAt,
    lastUpdatedAt: validTimestamp(source.lastUpdatedAt, now, now),
    guardStartedAt,
    sessionOpenAttemptCount: nonNegativeInteger(source.sessionOpenAttemptCount),
    sessionOpenSuccessCount: nonNegativeInteger(source.sessionOpenSuccessCount),
    failedOpen429Count: nonNegativeInteger(source.failedOpen429Count),
    historyRequestCount: nonNegativeInteger(source.historyRequestCount),
    singleFlightHitCount: nonNegativeInteger(source.singleFlightHitCount),
    olderPageSuppressedCount: nonNegativeInteger(source.olderPageSuppressedCount),
    rateLimitCooldownStartCount: nonNegativeInteger(source.rateLimitCooldownStartCount),
    rateLimitCooldownHitCount: nonNegativeInteger(source.rateLimitCooldownHitCount),
    spaSwitchCount: nonNegativeInteger(source.spaSwitchCount),
    windowFlappingDetectedCount: nonNegativeInteger(source.windowFlappingDetectedCount),
    switchLatencySamples: samples,
    maxActiveConversationDomNodes: nonNegativeInteger(source.maxActiveConversationDomNodes),
    maxDocumentDomNodes: nonNegativeInteger(source.maxDocumentDomNodes)
  });
}

function increment(value: number | undefined): number {
  return nonNegativeInteger(value);
}

export function applyStatsDelta(
  current: unknown,
  delta: GuardStatsDelta,
  buildId: string,
  now = Date.now()
): GuardStats {
  const stats = normalizeStats(current, buildId, now);
  const samples = [
    ...stats.switchLatencySamples,
    ...sanitizedSamples(delta.switchLatencySamples)
  ].slice(-MAX_SWITCH_LATENCY_SAMPLES);

  return withPercentiles({
    ...stats,
    statsVersion: STATS_VERSION,
    buildId,
    lastUpdatedAt: now,
    sessionOpenAttemptCount: stats.sessionOpenAttemptCount + increment(delta.sessionOpenAttemptCount),
    sessionOpenSuccessCount: stats.sessionOpenSuccessCount + increment(delta.sessionOpenSuccessCount),
    failedOpen429Count: stats.failedOpen429Count + increment(delta.failedOpen429Count),
    historyRequestCount: stats.historyRequestCount + increment(delta.historyRequestCount),
    singleFlightHitCount: stats.singleFlightHitCount + increment(delta.singleFlightHitCount),
    olderPageSuppressedCount: stats.olderPageSuppressedCount + increment(delta.olderPageSuppressedCount),
    rateLimitCooldownStartCount: stats.rateLimitCooldownStartCount + increment(delta.rateLimitCooldownStartCount),
    rateLimitCooldownHitCount: stats.rateLimitCooldownHitCount + increment(delta.rateLimitCooldownHitCount),
    spaSwitchCount: stats.spaSwitchCount + increment(delta.spaSwitchCount),
    windowFlappingDetectedCount: stats.windowFlappingDetectedCount + increment(delta.windowFlappingDetectedCount),
    switchLatencySamples: samples,
    maxActiveConversationDomNodes: Math.max(
      stats.maxActiveConversationDomNodes,
      nonNegativeInteger(delta.maxActiveConversationDomNodes)
    ),
    maxDocumentDomNodes: Math.max(stats.maxDocumentDomNodes, nonNegativeInteger(delta.maxDocumentDomNodes))
  });
}

export function resetStats(buildId: string, now = Date.now()): GuardStats {
  return createDefaultStats(buildId, now);
}
