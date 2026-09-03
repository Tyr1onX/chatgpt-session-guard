import { describe, expect, it } from 'vitest';
import { STORAGE_KEY as CONFIG_STORAGE_KEY } from '../src/shared/config';
import {
  STATS_STORAGE_KEY,
  STATS_VERSION,
  applyStatsDelta,
  createDefaultStats,
  normalizeStats,
  resetStats
} from '../src/shared/stats';

const BUILD_ID = 'test-build';
const NOW = 1_800_000_000_000;

describe('local protection stats', () => {
  it('increments single-flight hits by one', () => {
    const stats = applyStatsDelta(createDefaultStats(BUILD_ID, NOW), { singleFlightHitCount: 1 }, BUILD_ID, NOW + 1);
    expect(stats.singleFlightHitCount).toBe(1);
  });

  it('increments older-page suppression by one', () => {
    const stats = applyStatsDelta(createDefaultStats(BUILD_ID, NOW), { olderPageSuppressedCount: 1 }, BUILD_ID, NOW + 1);
    expect(stats.olderPageSuppressedCount).toBe(1);
  });

  it('increments 429 cooldown hits by one', () => {
    const stats = applyStatsDelta(createDefaultStats(BUILD_ID, NOW), { rateLimitCooldownHitCount: 1 }, BUILD_ID, NOW + 1);
    expect(stats.rateLimitCooldownHitCount).toBe(1);
  });

  it('increments failed-open 429 by one', () => {
    const stats = applyStatsDelta(createDefaultStats(BUILD_ID, NOW), { failedOpen429Count: 1 }, BUILD_ID, NOW + 1);
    expect(stats.failedOpen429Count).toBe(1);
  });

  it('does not count a normal successful open as 429', () => {
    const stats = applyStatsDelta(
      createDefaultStats(BUILD_ID, NOW),
      { sessionOpenAttemptCount: 1, sessionOpenSuccessCount: 1 },
      BUILD_ID,
      NOW + 1
    );
    expect(stats.sessionOpenAttemptCount).toBe(1);
    expect(stats.sessionOpenSuccessCount).toBe(1);
    expect(stats.failedOpen429Count).toBe(0);
  });

  it('reset replaces only the stats entry and leaves Guard config untouched', () => {
    const guardConfig = { enabled: false, mode: 'balanced' };
    const storage: Record<string, unknown> = {
      [CONFIG_STORAGE_KEY]: guardConfig,
      [STATS_STORAGE_KEY]: applyStatsDelta(createDefaultStats(BUILD_ID, NOW), { singleFlightHitCount: 9 }, BUILD_ID, NOW + 1)
    };
    storage[STATS_STORAGE_KEY] = resetStats(BUILD_ID, NOW + 2);
    expect(storage[CONFIG_STORAGE_KEY]).toEqual(guardConfig);
    expect((storage[STATS_STORAGE_KEY] as ReturnType<typeof resetStats>).singleFlightHitCount).toBe(0);
  });

  it('recovers corrupted storage to safe defaults', () => {
    const stats = normalizeStats('corrupted', BUILD_ID, NOW);
    expect(stats.statsVersion).toBe(STATS_VERSION);
    expect(stats.buildId).toBe(BUILD_ID);
    expect(stats.historyRequestCount).toBe(0);
    expect(stats.switchLatencySamples).toEqual([]);
  });

  it('migrates older object-shaped stats idempotently', () => {
    const legacy = {
      statsVersion: 0,
      firstSeenAt: NOW - 1000,
      guardStartedAt: NOW - 1000,
      singleFlightHitCount: 7,
      failedOpen429Count: 2,
      switchLatencySamples: [120, 80, 100]
    };
    const once = normalizeStats(legacy, BUILD_ID, NOW);
    const twice = normalizeStats(once, BUILD_ID, NOW);
    expect(twice).toEqual(once);
    expect(once.statsVersion).toBe(STATS_VERSION);
    expect(once.singleFlightHitCount).toBe(7);
    expect(once.failedOpen429Count).toBe(2);
    expect(once.switchLatencyP50).toBe(100);
  });
});
