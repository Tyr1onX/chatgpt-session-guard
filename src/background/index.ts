import { BENCHMARK_SESSION_KEY, type BenchmarkState } from '../shared/benchmark';
import { LONG_STRESS_SESSION_KEY, type LongStressState } from '../shared/long-stress';

declare const __CSG_DEBUG_BUILD__: boolean;

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
  | { type: 'csg:long-stress-clear' };

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const request = message as Partial<StorageRequest>;

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
