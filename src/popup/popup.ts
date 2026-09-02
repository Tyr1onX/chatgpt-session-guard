import {
  benchmarkFilename,
  benchmarkReport,
  type BenchmarkProfile,
  type BenchmarkState
} from '../shared/benchmark';
import {
  DEFAULT_CONFIG,
  STORAGE_KEY,
  applyModePreset,
  normalizeConfig,
  persistentConfig,
  type GuardConfig,
  type GuardMode,
  type HistoryUnit
} from '../shared/config';
import { longStressFilename, longStressReport, type LongStressState } from '../shared/long-stress';
import type { DebugMetrics, PopupRequest, PopupResponse } from '../shared/types';

declare const __CSG_DEBUG_BUILD__: boolean;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing popup element: ${id}`);
  return found as T;
}

const modeSelect = element<HTMLSelectElement>('mode');
const historyPreset = element<HTMLSelectElement>('historyPreset');
const historyCustom = element<HTMLElement>('historyCustom');
const historyUnit = element<HTMLSelectElement>('historyUnit');
const historyCount = element<HTMLInputElement>('historyCount');
const historyBatchSize = element<HTMLSelectElement>('historyBatchSize');
const loadPreviousHistory = element<HTMLButtonElement>('loadPreviousHistory');
const historyStatus = element<HTMLElement>('historyStatus');
const autoLoadHistory = element<HTMLSelectElement>('autoLoadHistory');
const toggleButton = element<HTMLButtonElement>('toggleEnabled');
const fullHistoryButton = element<HTMLButtonElement>('fullHistory');
const statusText = element<HTMLElement>('statusText');
const statusDot = element<HTMLElement>('statusDot');
const sessionState = element<HTMLElement>('sessionState');
const activeHistory = element<HTMLElement>('activeHistory');
const domBudgetState = element<HTMLElement>('domBudgetState');
const warning = element<HTMLElement>('warning');
const metricsList = element<HTMLDListElement>('metrics');

let config: GuardConfig = DEFAULT_CONFIG;

async function loadConfig(): Promise<GuardConfig> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeConfig(stored[STORAGE_KEY]);
}

async function saveConfig(next: GuardConfig): Promise<void> {
  config = normalizeConfig(persistentConfig(next));
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

function matchingPreset(): string {
  const exact = `${config.historyUnit}:${config.historyCount}`;
  return new Set(['message:1', 'round:1', 'round:2', 'round:4', 'round:8', 'round:16']).has(exact)
    ? exact
    : 'custom';
}

function renderConfig(): void {
  modeSelect.value = config.mode;
  historyPreset.value = matchingPreset();
  historyCustom.hidden = historyPreset.value !== 'custom';
  historyUnit.value = config.historyUnit;
  historyCount.value = String(config.historyCount);
  historyBatchSize.value = String(config.historyBatchSize);
  autoLoadHistory.value = String(config.autoLoadHistory);
  autoLoadHistory.disabled = config.mode === 'ultra-lite';
  statusText.textContent = `Status: ${config.enabled ? 'ON' : 'OFF'}`;
  statusDot.classList.toggle('off', !config.enabled);
  toggleButton.textContent = config.enabled ? 'Disable' : 'Enable';
  fullHistoryButton.textContent = config.temporaryFullHistory ? 'Restore Lightweight Mode' : 'Temporary Full History';
  warning.hidden = config.mode !== 'aggressive';
  domBudgetState.textContent = `Auto · ${Math.round(config.domBudget / 1000)}k`;
}

function renderMetrics(metrics: DebugMetrics | null): void {
  metricsList.replaceChildren();
  if (!metrics) {
    sessionState.textContent = 'Unavailable';
    activeHistory.textContent = '—';
    return;
  }

  if (!metrics.conversationId) sessionState.textContent = 'No active chat';
  else if (metrics.activeConversationDomNodes <= config.domBudget) sessionState.textContent = 'Clean';
  else sessionState.textContent = 'Pressure';

  const unit = metrics.historyUnit === 'message' ? 'messages' : 'rounds';
  const active = metrics.historyUnit === 'message' ? metrics.renderedMessages : metrics.renderedRounds;
  activeHistory.textContent = `${active} / ${metrics.configuredHistoryCount} ${unit}${metrics.limitedByDomBudget ? ' · budget-limited' : ''}`;

  const rows: Array<[string, string]> = [
    ['Conversation ID', metrics.conversationId ?? '—'],
    ['SPA switches', String(metrics.spaSwitchCount)],
    ['Rendered rounds', `${metrics.renderedRounds} / ${metrics.totalRounds}`],
    ['Rendered messages', `${metrics.renderedMessages} / ${metrics.totalMessages}`],
    ['History target', `${metrics.configuredHistoryCount} ${metrics.historyUnit}${metrics.limitedByDomBudget ? ' · budget-limited' : ''}`],
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

async function loadLongStressState(): Promise<LongStressState | null> {
  if (!__CSG_DEBUG_BUILD__) return null;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'csg:long-stress-get' }) as { state?: LongStressState | null } | undefined;
    return response?.state ?? null;
  } catch {
    return null;
  }
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
  const profile = element<HTMLSelectElement>('benchmarkProfile');
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
  const longStressMessage = element<HTMLElement>('longStressMessage');
  const longStressStart = element<HTMLButtonElement>('longStressStart');
  const longStressStop = element<HTMLButtonElement>('longStressStop');
  const longStressDownloads = element<HTMLElement>('longStressDownloads');
  const longStressJson = element<HTMLButtonElement>('longStressJson');
  const longStressReportButton = element<HTMLButtonElement>('longStressReport');
  const stabilityTraceMessage = element<HTMLElement>('stabilityTraceMessage');
  const stabilityTraceJson = element<HTMLButtonElement>('stabilityTraceJson');
  const stabilityTraceReportButton = element<HTMLButtonElement>('stabilityTraceReport');
  let latestLongStress: LongStressState | null = null;
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
            : profile.value === 'experimental'
              ? 'Experimental profile runs Aggressive only. Session GC stays separate.'
              : 'Standard Validation compares Control, Balanced and Ultra Lite. Hard Switch stays off.'
    );
    start.hidden = active;
    start.textContent = state && ['complete', 'stopped', 'failed'].includes(state.status) ? 'Start New Benchmark' : 'Start Benchmark';
    stop.hidden = !active;
    resume.hidden = state?.status !== 'paused-user';
    downloads.hidden = state?.status !== 'complete';
    sessionGc.hidden = !(state?.status === 'complete' && state.profile === 'experimental' && state.results.aggressive.analysis?.spaRetainedStateLikely === true && !state.sessionGc);
    loops.disabled = active;
    profile.disabled = active;
    modeSelect.disabled = active;
    historyPreset.disabled = active;
    historyBatchSize.disabled = active;
    autoLoadHistory.disabled = active || config.mode === 'ultra-lite';
    toggleButton.disabled = active;
    fullHistoryButton.disabled = active;
    loadPreviousHistory.disabled = active;
  };

  const refresh = async (): Promise<void> => {
    render(await loadBenchmarkState());
    latestLongStress = await loadLongStressState();
    const stressActive = latestLongStress ? ['preparing', 'reloading', 'measuring'].includes(latestLongStress.status) : false;
    longStressStart.hidden = stressActive;
    longStressStop.hidden = !stressActive;
    longStressDownloads.hidden = latestLongStress?.status !== 'complete';
    longStressMessage.textContent = latestLongStress
      ? latestLongStress.error ?? (latestLongStress.status === 'complete'
        ? 'Long Conversation Stress complete.'
        : `Long Stress: step ${Math.min(latestLongStress.stepIndex + 1, 5)} / 5 · ${latestLongStress.status}`)
      : 'Tests this current long conversation at 8r / 4r / 2r / 1r / 1 message.';
  };
  loops.addEventListener('change', () => {
    if (!latestState || !activeStatuses.has(latestState.status)) progress.textContent = `0 / ${Number(loops.value) * 10}`;
  });
  profile.addEventListener('change', () => render(latestState));

  start.addEventListener('click', async () => {
    message.textContent = 'Starting benchmark…';
    const requestedLoops = loops.value === '5' ? 5 : 10;
    const requestedProfile: BenchmarkProfile = profile.value === 'experimental' ? 'experimental' : 'standard';
    const response = await sendToActiveTab({ type: 'csg:benchmark-start', loops: requestedLoops, profile: requestedProfile });
    if (!response?.ok) {
      message.textContent = response?.error ?? 'Open a logged-in chatgpt.com tab and try again.';
      return;
    }
    await refresh();
  });
  stop.addEventListener('click', async () => { await sendToActiveTab({ type: 'csg:benchmark-stop' }); await refresh(); });
  resume.addEventListener('click', async () => { await sendToActiveTab({ type: 'csg:benchmark-resume' }); await refresh(); });
  sessionGc.addEventListener('click', async () => {
    const response = await sendToActiveTab({ type: 'csg:session-gc-start' });
    if (!response?.ok) message.textContent = response?.error ?? 'Unable to start Session GC benchmark.';
    else await refresh();
  });
  json.addEventListener('click', () => {
    if (!latestState) return;
    const timestamp = latestState.completedAt ?? Date.now();
    downloadText(benchmarkFilename('benchmark-results', timestamp, 'json'), JSON.stringify(latestState, null, 2), 'application/json;charset=utf-8');
  });
  report.addEventListener('click', () => {
    if (!latestState) return;
    const timestamp = latestState.completedAt ?? Date.now();
    downloadText(benchmarkFilename('benchmark-report', timestamp, 'md'), benchmarkReport(latestState), 'text/markdown;charset=utf-8');
  });
  longStressStart.addEventListener('click', async () => {
    longStressMessage.textContent = 'Starting Long Conversation Stress…';
    const response = await sendToActiveTab({ type: 'csg:long-stress-start' });
    if (!response?.ok) longStressMessage.textContent = response?.error ?? 'Unable to start Long Conversation Stress.';
    else await refresh();
  });
  longStressStop.addEventListener('click', async () => {
    await sendToActiveTab({ type: 'csg:long-stress-stop' });
    await refresh();
  });
  longStressJson.addEventListener('click', () => {
    if (!latestLongStress) return;
    const timestamp = latestLongStress.completedAt ?? Date.now();
    downloadText(longStressFilename('long-stress-results', timestamp, 'json'), JSON.stringify(latestLongStress, null, 2), 'application/json;charset=utf-8');
  });
  longStressReportButton.addEventListener('click', () => {
    if (!latestLongStress) return;
    const timestamp = latestLongStress.completedAt ?? Date.now();
    downloadText(longStressFilename('long-stress-report', timestamp, 'md'), longStressReport(latestLongStress), 'text/markdown;charset=utf-8');
  });
  stabilityTraceJson.addEventListener('click', async () => {
    const response = await sendToActiveTab({ type: 'csg:stability-trace-get' });
    if (!response?.stabilityTrace) { stabilityTraceMessage.textContent = 'No Stability Trace is available on this tab.'; return; }
    const snapshot = response.stabilityTrace as { flappingDetected?: boolean };
    stabilityTraceMessage.textContent = snapshot.flappingDetected ? 'WINDOW_FLAPPING_DETECTED · trace exported.' : 'Stability Trace exported.';
    downloadText('stability-trace-' + Date.now() + '.json', JSON.stringify(response.stabilityTrace, null, 2), 'application/json;charset=utf-8');
  });
  stabilityTraceReportButton.addEventListener('click', async () => {
    const response = await sendToActiveTab({ type: 'csg:stability-trace-get' });
    if (!response?.stabilityReport) { stabilityTraceMessage.textContent = 'No Stability Trace report is available on this tab.'; return; }
    const snapshot = response.stabilityTrace as { flappingDetected?: boolean } | undefined;
    stabilityTraceMessage.textContent = snapshot?.flappingDetected ? 'WINDOW_FLAPPING_DETECTED · report exported.' : 'Stability report exported.';
    downloadText('stability-report-' + Date.now() + '.md', response.stabilityReport, 'text/markdown;charset=utf-8');
  });

  void refresh();
  window.setInterval(() => { void refresh(); }, 500);
}

modeSelect.addEventListener('change', () => {
  const mode = modeSelect.value as GuardMode;
  let next = applyModePreset(config, mode);
  if (config.mode === 'ultra-lite' && mode === 'balanced' && config.historyUnit === 'round' && config.historyCount === 1) {
    next = normalizeConfig({ ...next, historyUnit: 'round', historyCount: 8 });
  }
  void saveConfig(next);
});

historyPreset.addEventListener('change', () => {
  const value = historyPreset.value;
  historyCustom.hidden = value !== 'custom';
  if (value === 'custom') return;
  const [unit, count] = value.split(':');
  if ((unit === 'message' || unit === 'round') && count) {
    void saveConfig({ ...config, historyUnit: unit, historyCount: Number.parseInt(count, 10) });
  }
});

const saveCustomHistory = (): void => {
  const unit: HistoryUnit = historyUnit.value === 'message' ? 'message' : 'round';
  const count = Math.min(50, Math.max(1, Number.parseInt(historyCount.value, 10) || 1));
  void saveConfig({ ...config, historyUnit: unit, historyCount: count });
};
historyUnit.addEventListener('change', saveCustomHistory);
historyCount.addEventListener('change', saveCustomHistory);
autoLoadHistory.addEventListener('change', () => {
  const enabled = config.mode === 'ultra-lite' ? false : autoLoadHistory.value === 'true';
  void saveConfig({ ...config, autoLoadHistory: enabled });
});

historyBatchSize.addEventListener('change', () => {
  const batch = Math.min(50, Math.max(1, Number.parseInt(historyBatchSize.value, 10) || 10));
  void saveConfig({ ...config, historyBatchSize: batch });
});

loadPreviousHistory.addEventListener('click', async () => {
  historyStatus.textContent = 'Preparing older history…';
  const response = await sendToActiveTab({ type: 'csg:history-load-previous' });
  if (!response?.ok) historyStatus.textContent = response?.error ?? 'Unable to load older history.';
});

toggleButton.addEventListener('click', () => { void saveConfig({ ...config, enabled: !config.enabled }); });
fullHistoryButton.addEventListener('click', async () => {
  const request: PopupRequest = config.temporaryFullHistory
    ? { type: 'csg:restore-lightweight' }
    : { type: 'csg:temporary-full-history' };
  const response = await sendToActiveTab(request);
  if (!response?.ok) historyStatus.textContent = response?.error ?? 'Unable to reload current history mode.';
});

void (async () => {
  config = await loadConfig();
  renderConfig();
  renderMetrics(await getMetrics());
  setupBenchmarkUi();
})();
