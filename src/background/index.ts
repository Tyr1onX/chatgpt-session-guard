import { BENCHMARK_SESSION_KEY, type BenchmarkState } from '../shared/benchmark';
import { LONG_STRESS_SESSION_KEY, type LongStressState } from '../shared/long-stress';
import {
  STATS_STORAGE_KEY,
  applyStatsDelta,
  normalizeStats,
  resetStats,
  type GuardStats,
  type GuardStatsDelta
} from '../shared/stats';

declare const __CSG_DEBUG_BUILD__: boolean;
declare const __CSG_BUILD_ID__: string;

const HISTORY_SESSION_KEY = 'csg.history.expansion.v1';

interface HistoryExpansionState {
  conversationId: string;
  amount: number;
}

type StorageRequest =
  | { type: 'csg:benchmark-storage-get' }
  | { type: 'csg:benchmark-storage-set'; state: BenchmarkState }
  | { type: 'csg:benchmark-storage-clear' }
  | { type: 'csg:history-session-get' }
  | { type: 'csg:history-session-set'; state: HistoryExpansionState }
  | { type: 'csg:history-session-clear' }
  | { type: 'csg:long-stress-get' }
  | { type: 'csg:long-stress-set'; state: LongStressState }
  | { type: 'csg:long-stress-clear' }
  | { type: 'csg:stats-get' }
  | { type: 'csg:stats-apply-delta'; delta: GuardStatsDelta }
  | { type: 'csg:stats-reset' };

let statsQueue: Promise<void> = Promise.resolve();

function queueStats<T>(task: () => Promise<T>): Promise<T> {
  const run = statsQueue.then(task, task);
  statsQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function readStats(): Promise<GuardStats> {
  const stored = await chrome.storage.local.get(STATS_STORAGE_KEY);
  return normalizeStats(stored[STATS_STORAGE_KEY], __CSG_BUILD_ID__);
}

async function readAndRepairStats(): Promise<GuardStats> {
  const stats = await readStats();
  await chrome.storage.local.set({ [STATS_STORAGE_KEY]: stats });
  return stats;
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const request = message as Partial<StorageRequest>;

  if (request.type === 'csg:stats-get') {
    void queueStats(readAndRepairStats)
      .then((state) => sendResponse({ state }))
      .catch(() => sendResponse({ state: normalizeStats(null, __CSG_BUILD_ID__) }));
    return true;
  }
  if (request.type === 'csg:stats-apply-delta') {
    const delta = 'delta' in request ? request.delta : undefined;
    if (!delta || typeof delta !== 'object') return false;
    void queueStats(async () => {
      const current = await readStats();
      const state = applyStatsDelta(current, delta as GuardStatsDelta, __CSG_BUILD_ID__);
      await chrome.storage.local.set({ [STATS_STORAGE_KEY]: state });
      return state;
    }).then((state) => sendResponse({ ok: true, state })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (request.type === 'csg:stats-reset') {
    void queueStats(async () => {
      const state = resetStats(__CSG_BUILD_ID__);
      await chrome.storage.local.set({ [STATS_STORAGE_KEY]: state });
      return state;
    }).then((state) => sendResponse({ ok: true, state })).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (request.type === 'csg:history-session-get') {
    void chrome.storage.session.get(HISTORY_SESSION_KEY)
      .then((stored) => sendResponse({ state: stored[HISTORY_SESSION_KEY] ?? null }))
      .catch(() => sendResponse({ state: null }));
    return true;
  }
  if (request.type === 'csg:history-session-set') {
    if (!('state' in request) || !request.state) return false;
    const state = request.state as HistoryExpansionState;
    if (typeof state.conversationId !== 'string' || !Number.isFinite(state.amount)) return false;
    void chrome.storage.session.set({
      [HISTORY_SESSION_KEY]: {
        conversationId: state.conversationId,
        amount: Math.max(0, Math.min(200, Math.round(state.amount)))
      }
    }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (request.type === 'csg:history-session-clear') {
    void chrome.storage.session.remove(HISTORY_SESSION_KEY)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (__CSG_DEBUG_BUILD__ && request.type === 'csg:long-stress-get') {
    void chrome.storage.session.get(LONG_STRESS_SESSION_KEY)
      .then((stored) => sendResponse({ state: stored[LONG_STRESS_SESSION_KEY] ?? null }))
      .catch(() => sendResponse({ state: null }));
    return true;
  }
  if (__CSG_DEBUG_BUILD__ && request.type === 'csg:long-stress-set') {
    if (!('state' in request) || !request.state) return false;
    void chrome.storage.session.set({ [LONG_STRESS_SESSION_KEY]: request.state })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (__CSG_DEBUG_BUILD__ && request.type === 'csg:long-stress-clear') {
    void chrome.storage.session.remove(LONG_STRESS_SESSION_KEY)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (!__CSG_DEBUG_BUILD__) return false;
  if (request.type === 'csg:benchmark-storage-get') {
    void chrome.storage.session.get(BENCHMARK_SESSION_KEY)
      .then((stored) => sendResponse({ state: stored[BENCHMARK_SESSION_KEY] ?? null }))
      .catch(() => sendResponse({ state: null }));
    return true;
  }
  if (request.type === 'csg:benchmark-storage-set') {
    if (!('state' in request) || !request.state) return false;
    void chrome.storage.session.set({ [BENCHMARK_SESSION_KEY]: request.state })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (request.type === 'csg:benchmark-storage-clear') {
    void chrome.storage.session.remove(BENCHMARK_SESSION_KEY)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  return false;
});
