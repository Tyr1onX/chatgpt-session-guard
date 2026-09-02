import { BENCHMARK_SESSION_KEY, type BenchmarkState } from '../shared/benchmark';

type StorageRequest =
  | { type: 'csg:benchmark-storage-get' }
  | { type: 'csg:benchmark-storage-set'; state: BenchmarkState }
  | { type: 'csg:benchmark-storage-clear' };

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const request = message as Partial<StorageRequest>;
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
