import {
  benchmarkFilename,
  benchmarkReport,
  type BenchmarkState
} from '../shared/benchmark';
import { DEFAULT_CONFIG, STORAGE_KEY, normalizeConfig, type GuardConfig, type GuardMode } from '../shared/config';
import type { DebugMetrics, PopupRequest, PopupResponse } from '../shared/types';

declare const __CSG_DEBUG_BUILD__: boolean;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing popup element: ${id}`);
  return found as T;
}

const modeSelect = element<HTMLSelectElement>('mode');
const recentRoundsInput = element<HTMLInputElement>('recentRounds');
const toggleButton = element<HTMLButtonElement>('toggleEnabled');
const fullHistoryButton = element<HTMLButtonElement>('fullHistory');
const statusText = element<HTMLElement>('statusText');
const statusDot = element<HTMLElement>('statusDot');
const sessionState = element<HTMLElement>('sessionState');
const warning = element<HTMLElement>('warning');
const metricsList = element<HTMLDListElement>('metrics');

let config: GuardConfig = DEFAULT_CONFIG;

async function loadConfig(): Promise<GuardConfig> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeConfig(stored[STORAGE_KEY]);
}

async function saveConfig(next: GuardConfig): Promise<void> {
  config = normalizeConfig(next);
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
  renderConfig();
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] ?? null;
  } catch {
    return null;
  }
}

async function sendToActiveTab(request: PopupRequest): Promise<PopupResponse | null> {
  const tab = await activeTab();
  if (typeof tab?.id !== 'number') return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, request) as PopupResponse | null;
  } catch {
    return null;
  }
}

async function getMetrics(): Promise<DebugMetrics | null> {
  return (await sendToActiveTab({ type: 'csg:get-state' }))?.metrics ?? null;
}

function renderConfig(): void {
  modeSelect.value = config.mode;
  recentRoundsInput.value = String(config.recentRounds);
  statusText.textContent = `Status: ${config.enabled ? 'ON' : 'OFF'}`;
  statusDot.classList.toggle('off', !config.enabled);
  toggleButton.textContent = config.enabled ? 'Disable' : 'Enable';
  fullHistoryButton.textContent = config.temporaryFullHistory ? 'Restore Lightweight Mode' : 'Temporary Full History';
  warning.hidden = config.mode !== 'aggressive';
}

function renderMetrics(metrics: DebugMetrics | null): void {
  metricsList.replaceChildren();
  if (!metrics) {
    sessionState.textContent = 'Unavailable';
    return;
  }

  if (!metrics.conversationId) sessionState.textContent = 'No active chat';
  else if (metrics.activeConversationDomNodes <= config.domBudget) sessionState.textContent = 'Clean';
  else sessionState.textContent = 'Pressure';

  const rows: Array<[string, string]> = [
    ['Conversation ID', metrics.conversationId ?? '—'],
    ['SPA switches', String(metrics.spaSwitchCount)],
    ['Rendered rounds', `${metrics.renderedRounds} / ${metrics.totalRounds}`],
    ['Conversation DOM', String(metrics.conversationDomNodes)],
    ['Active DOM', String(metrics.activeConversationDomNodes)],
    ['Document DOM', String(metrics.totalDocumentDomNodes)],
    ['Network Guard', metrics.networkMode],
    ['Network turns', metrics.networkRequestedTurns === null ? 'n/a' : `${metrics.networkRequestedTurns} → ${metrics.networkEffectiveTurns ?? metrics.networkRequestedTurns}`],
    ['Cleanup count', String(metrics.cleanupCount)],
    ['Hard switches', String(metrics.hardSwitchCount)],
    ['Switch latency', metrics.switchLatencyMs === null ? 'n/a' : `${metrics.switchLatencyMs} ms`],
    ['JS heap', metrics.jsHeapMb === null ? 'n/a' : `${metrics.jsHeapMb} MB`]
  ];

  for (const [key, value] of rows) {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = key;
    dd.textContent = value;
    metricsList.append(dt, dd);
  }
}

function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadBenchmarkState(): Promise<BenchmarkState | null> {
  if (!__CSG_DEBUG_BUILD__) return null;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'csg:benchmark-storage-get' }) as { state?: BenchmarkState | null } | undefined;
    return response?.state ?? null;
  } catch {
    return null;
  }
}

function currentBenchmarkSample(state: BenchmarkState) {
  if (state.phase === 'session-gc') return state.sessionGc?.samples.at(-1) ?? null;
  const index = Math.min(state.modeIndex, state.modeOrder.length - 1);
  const mode = state.modeOrder[index];
  return mode ? state.results[mode].samples.at(-1) ?? null : null;
}

function setupBenchmarkUi(): void {
  if (!__CSG_DEBUG_BUILD__) return;
  const conversations = element<HTMLElement>('benchmarkConversations');
  const mode = element<HTMLElement>('benchmarkMode');
  const progress = element<HTMLElement>('benchmarkProgress');
  const dom = element<HTMLElement>('benchmarkDom');
  const heap = element<HTMLElement>('benchmarkHeap');
  const latency = element<HTMLElement>('benchmarkLatency');
  const loops = element<HTMLSelectElement>('benchmarkLoops');
  const message = element<HTMLElement>('benchmarkMessage');
  const start = element<HTMLButtonElement>('benchmarkStart');
  const stop = element<HTMLButtonElement>('benchmarkStop');
  const resume = element<HTMLButtonElement>('benchmarkResume');
  const downloads = element<HTMLElement>('benchmarkDownloads');
  const json = element<HTMLButtonElement>('benchmarkJson');
  const report = element<HTMLButtonElement>('benchmarkReport');
  const sessionGc = element<HTMLButtonElement>('benchmarkSessionGc');
  let latestState: BenchmarkState | null = null;

  const activeStatuses = new Set(['preparing', 'reloading', 'running', 'paused-busy', 'paused-user', 'retrying']);

  const render = (state: BenchmarkState | null): void => {
    latestState = state;
    const sample = state ? currentBenchmarkSample(state) : null;
    const active = state ? activeStatuses.has(state.status) : false;
    const currentMode = state?.phase === 'session-gc'
      ? 'Session GC'
      : state?.modeOrder[Math.min(state.modeIndex, state.modeOrder.length - 1)] ?? 'Idle';
    conversations.textContent = state ? String(state.conversationIds.length) : '—';
    mode.textContent = currentMode;
    progress.textContent = state ? `${state.currentSwitch} / ${state.switchesPerMode}` : `0 / ${Number(loops.value) * 10}`;
    dom.textContent = sample ? String(sample.documentDomNodes) : '—';
    heap.textContent = sample?.jsHeapMb === null || sample?.jsHeapMb === undefined ? '—' : `${sample.jsHeapMb.toFixed(1)} MB`;
    latency.textContent = sample?.switchLatencyMs === null || sample?.switchLatencyMs === undefined ? '—' : `${sample.switchLatencyMs.toFixed(1)} ms`;
    message.textContent = state?.pauseReason ?? (
      state?.status === 'complete'
        ? `Benchmark complete · ${state.conclusion ?? 'inconclusive'}`
        : state?.status === 'stopped'
          ? 'Benchmark stopped.'
          : active
            ? 'Benchmark is running automatically. Avoid interacting with ChatGPT until it finishes.'
            : 'Control → Balanced → Aggressive. Hard Switch stays off.'
    );
    start.hidden = active;
    start.textContent = state && ['complete', 'stopped', 'failed'].includes(state.status) ? 'Start New Benchmark' : 'Start Benchmark';
    stop.hidden = !active;
    resume.hidden = state?.status !== 'paused-user';
    downloads.hidden = state?.status !== 'complete';
    sessionGc.hidden = !(state?.status === 'complete' && state.phase === 'primary' && state.results.aggressive.analysis?.spaRetainedStateLikely === true && !state.sessionGc);
    loops.disabled = active;
    modeSelect.disabled = active;
    recentRoundsInput.disabled = active;
    toggleButton.disabled = active;
    fullHistoryButton.disabled = active;
  };

  const refresh = async (): Promise<void> => {
    render(await loadBenchmarkState());
  };

  loops.addEventListener('change', () => {
    if (!latestState || !activeStatuses.has(latestState.status)) {
      progress.textContent = `0 / ${Number(loops.value) * 10}`;
    }
  });

  start.addEventListener('click', async () => {
    message.textContent = 'Starting benchmark…';
    const requestedLoops = loops.value === '10' ? 10 : 5;
    const response = await sendToActiveTab({ type: 'csg:benchmark-start', loops: requestedLoops });
    if (!response?.ok) {
      message.textContent = response?.error ?? 'Open a logged-in chatgpt.com tab and try again.';
      return;
    }
    await refresh();
  });

  stop.addEventListener('click', async () => {
    await sendToActiveTab({ type: 'csg:benchmark-stop' });
    await refresh();
  });

  resume.addEventListener('click', async () => {
    await sendToActiveTab({ type: 'csg:benchmark-resume' });
    await refresh();
  });

  json.addEventListener('click', () => {
    if (!latestState) return;
    const timestamp = latestState.completedAt ?? Date.now();
    downloadText(
      benchmarkFilename('benchmark-results', timestamp, 'json'),
      JSON.stringify(latestState, null, 2),
      'application/json;charset=utf-8'
    );
  });

  sessionGc.addEventListener('click', async () => {
    const response = await sendToActiveTab({ type: 'csg:session-gc-start' });
    if (!response?.ok) {
      message.textContent = response?.error ?? 'Unable to start Session GC benchmark.';
      return;
    }
    await refresh();
  });

  report.addEventListener('click', () => {
    if (!latestState) return;
    const timestamp = latestState.completedAt ?? Date.now();
    downloadText(
      benchmarkFilename('benchmark-report', timestamp, 'md'),
      benchmarkReport(latestState),
      'text/markdown;charset=utf-8'
    );
  });

  void refresh();
  window.setInterval(() => { void refresh(); }, 500);
}

modeSelect.addEventListener('change', () => {
  const mode = modeSelect.value as GuardMode;
  void saveConfig({ ...config, mode });
});

recentRoundsInput.addEventListener('change', () => {
  const recentRounds = Number.parseInt(recentRoundsInput.value, 10);
  void saveConfig({ ...config, recentRounds });
});

toggleButton.addEventListener('click', () => {
  void saveConfig({ ...config, enabled: !config.enabled });
});

fullHistoryButton.addEventListener('click', async () => {
  await saveConfig({ ...config, temporaryFullHistory: !config.temporaryFullHistory });
  const tab = await activeTab();
  if (typeof tab?.id === 'number') {
    try {
      await chrome.tabs.reload(tab.id);
    } catch {
      // Storage state still applies on the user's next manual reload.
    }
  }
});

void (async () => {
  config = await loadConfig();
  renderConfig();
  renderMetrics(await getMetrics());
  setupBenchmarkUi();
})();
