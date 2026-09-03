import { strToU8, zipSync } from 'fflate';
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
import type { GuardStats } from '../shared/stats';
import { FIELD_STORAGE_KEY, fieldIncidentReport, normalizeFieldStore, type FieldIncident } from '../shared/field-recorder';
import type { DebugMetrics, PopupRequest, PopupResponse } from '../shared/types';

declare const __CSG_DEBUG_BUILD__: boolean;
declare const __CSG_FIELD_BUILD__: boolean;
declare const __CSG_BUILD_ID__: string;

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
const metricsList = __CSG_DEBUG_BUILD__ && !__CSG_FIELD_BUILD__ ? element<HTMLDListElement>('metrics') : null;
const statsSessionOpen = element<HTMLElement>('statsSessionOpen');
const statsSingleFlight = element<HTMLElement>('statsSingleFlight');
const statsOlderSuppressed = element<HTMLElement>('statsOlderSuppressed');
const stats429 = element<HTMLElement>('stats429');
const statsFlapping = element<HTMLElement>('statsFlapping');
const statsDetails = element<HTMLDListElement>('statsDetails');
const resetStatsButton = element<HTMLButtonElement>('resetStats');
const statsStatus = element<HTMLElement>('statsStatus');

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

async function loadStats(): Promise<GuardStats | null> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'csg:stats-get' }) as { state?: GuardStats } | undefined;
    return response?.state ?? null;
  } catch {
    return null;
  }
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
  statusText.textContent = `状态：${config.enabled ? '已启用' : '已停用'}`;
  statusDot.classList.toggle('off', !config.enabled);
  toggleButton.textContent = config.enabled ? '停用' : '启用';
  fullHistoryButton.textContent = config.temporaryFullHistory ? '恢复轻量模式' : '临时显示完整历史';
  warning.hidden = config.mode !== 'aggressive';
  domBudgetState.textContent = `自动 · ${Math.round(config.domBudget / 1000)}k`;
}

function renderMetrics(metrics: DebugMetrics | null): void {
  metricsList?.replaceChildren();
  if (!metrics) {
    sessionState.textContent = '不可用';
    activeHistory.textContent = '—';
    return;
  }

  if (!metrics.conversationId) sessionState.textContent = '未打开会话';
  else if (metrics.activeConversationDomNodes <= config.domBudget) sessionState.textContent = '正常';
  else sessionState.textContent = '压力较高';

  const unit = metrics.historyUnit === 'message' ? '条消息' : '轮';
  const active = metrics.historyUnit === 'message' ? metrics.renderedMessages : metrics.renderedRounds;
  activeHistory.textContent = `${active} / ${metrics.configuredHistoryCount} ${unit}${metrics.limitedByDomBudget ? ' · 受 DOM 预算限制' : ''}`;

  if (!metricsList) return;
  const rows: Array<[string, string]> = [
    ['Conversation ID', metrics.conversationId ?? '—'],
    ['SPA 切换', String(metrics.spaSwitchCount)],
    ['已渲染轮次', `${metrics.renderedRounds} / ${metrics.totalRounds}`],
    ['已渲染消息', `${metrics.renderedMessages} / ${metrics.totalMessages}`],
    ['历史目标', `${metrics.configuredHistoryCount} ${metrics.historyUnit}${metrics.limitedByDomBudget ? ' · budget-limited' : ''}`],
    ['会话 DOM', String(metrics.conversationDomNodes)],
    ['活跃 DOM', String(metrics.activeConversationDomNodes)],
    ['文档 DOM', String(metrics.totalDocumentDomNodes)],
    ['Network Guard', metrics.networkMode],
    ['网络轮次', metrics.networkRequestedTurns === null ? 'n/a' : `${metrics.networkRequestedTurns} → ${metrics.networkEffectiveTurns ?? metrics.networkRequestedTurns}`],
    ['清理次数', String(metrics.cleanupCount)],
    ['Hard Switch 次数', String(metrics.hardSwitchCount)],
    ['切换延迟', metrics.switchLatencyMs === null ? 'n/a' : `${metrics.switchLatencyMs} ms`],
    ['JS 堆内存', metrics.jsHeapMb === null ? 'n/a' : `${metrics.jsHeapMb} MB`]
  ];

  appendRows(metricsList, rows);
}

function appendRows(list: HTMLDListElement, rows: Array<[string, string]>): void {
  for (const [key, value] of rows) {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = key;
    dd.textContent = value;
    list.append(dt, dd);
  }
}

function formatTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatLatency(value: number | null): string {
  return value === null ? '样本不足' : `${value} ms`;
}

function renderStats(stats: GuardStats | null): void {
  statsDetails.replaceChildren();
  if (!stats) {
    statsSessionOpen.textContent = '—';
    statsSingleFlight.textContent = '—';
    statsOlderSuppressed.textContent = '—';
    stats429.textContent = '—';
    statsFlapping.textContent = '—';
    statsStatus.textContent = '本地统计暂时不可用。';
    return;
  }

  statsSessionOpen.textContent = String(stats.sessionOpenAttemptCount);
  statsSingleFlight.textContent = String(stats.singleFlightHitCount);
  statsOlderSuppressed.textContent = String(stats.olderPageSuppressedCount);
  stats429.textContent = String(stats.failedOpen429Count);
  statsFlapping.textContent = String(stats.windowFlappingDetectedCount);
  statsStatus.textContent = '';

  appendRows(statsDetails, [
    ['成功打开会话', String(stats.sessionOpenSuccessCount)],
    ['真实历史网络请求', String(stats.historyRequestCount)],
    ['429 冷却启动', String(stats.rateLimitCooldownStartCount)],
    ['429 冷却期阻止重试', String(stats.rateLimitCooldownHitCount)],
    ['SPA 切换', String(stats.spaSwitchCount)],
    ['切换延迟 p50', formatLatency(stats.switchLatencyP50)],
    ['切换延迟 p95', formatLatency(stats.switchLatencyP95)],
    ['最大活跃会话 DOM', String(stats.maxActiveConversationDomNodes)],
    ['最大文档 DOM', String(stats.maxDocumentDomNodes)],
    ['首次统计', formatTimestamp(stats.firstSeenAt)],
    ['最近更新', formatTimestamp(stats.lastUpdatedAt)],
    ['Build ID', stats.buildId]
  ]);
}

function downloadText(filename: string, content: string, mime: string): void {
  const bytes = Uint8Array.from(content);
  const blob = new Blob([bytes.buffer], { type: mime });
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

function downloadBytes(filename: string, content: Uint8Array, mime: string): void {
  const buffer = new ArrayBuffer(content.byteLength);
  new Uint8Array(buffer).set(content);
  const blob = new Blob([buffer], { type: mime });
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

async function loadLatestFieldIncident(): Promise<{ count: number; incident: FieldIncident | null }> {
  const stored = await chrome.storage.local.get(FIELD_STORAGE_KEY);
  const store = normalizeFieldStore(stored[FIELD_STORAGE_KEY]);
  return { count: store.incidents.length, incident: store.incidents.at(-1) ?? null };
}

function setupFieldRecorderUi(): void {
  if (!__CSG_FIELD_BUILD__) return;
  const status = element<HTMLElement>('fieldRecorderStatus');
  const count = element<HTMLElement>('fieldIncidentCount');
  const recent = element<HTMLElement>('fieldRecentIncident');
  const build = element<HTMLElement>('fieldBuildId');
  const exportButton = element<HTMLButtonElement>('fieldExport');
  const resetButton = element<HTMLButtonElement>('fieldReset');
  const message = element<HTMLElement>('fieldMessage');
  let latest: FieldIncident | null = null;

  const refresh = async (): Promise<void> => {
    const [local, runtime] = await Promise.all([
      loadLatestFieldIncident(),
      sendToActiveTab({ type: 'csg:field-status' })
    ]);
    latest = local.incident;
    count.textContent = String(local.count);
    recent.textContent = latest?.incidentCodes[0] ?? '无';
    build.textContent = runtime?.fieldStatus?.buildId ?? __CSG_BUILD_ID__;
    status.textContent = runtime?.fieldStatus?.listening ? '监听中' : '已启用 · 当前页未连接';
    exportButton.disabled = latest === null;
  };

  exportButton.addEventListener('click', () => {
    if (!latest) { message.textContent = '当前还没有捕获到现场事件。'; return; }
    const buildInfo = {
      buildId: latest.buildId,
      buildFlavor: 'field',
      extensionVersion: chrome.runtime.getManifest().version,
      exportedAt: Date.now()
    };
    const sanitizedTrace = {
      schemaVersion: 1,
      traceExcerpt: latest.traceExcerpt,
      networkSummary: latest.networkSummary
    };
    const zip = zipSync({
      'field-incident.json': strToU8(JSON.stringify(latest, null, 2)),
      'stability-trace.json': strToU8(JSON.stringify(sanitizedTrace, null, 2)),
      'field-report.md': strToU8(fieldIncidentReport(latest)),
      'build-info.json': strToU8(JSON.stringify(buildInfo, null, 2))
    }, { level: 6 });
    downloadBytes('ChatGPT-Session-Guard-Field-Incident-' + latest.triggerTimestamp + '.zip', zip, 'application/zip');
    message.textContent = '现场诊断已导出。';
  });

  resetButton.addEventListener('click', async () => {
    await chrome.storage.local.remove(FIELD_STORAGE_KEY);
    await sendToActiveTab({ type: 'csg:field-reset' });
    message.textContent = '现场诊断已清除。';
    await refresh();
  });

  void refresh();
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

function benchmarkModeLabel(value: string): string {
  const labels: Record<string, string> = {
    control: 'Control',
    safe: '安全',
    balanced: '均衡',
    'ultra-lite': '极简',
    aggressive: '激进'
  };
  return labels[value] ?? value;
}

function setupBenchmarkUi(): void {
  if (!__CSG_DEBUG_BUILD__ || __CSG_FIELD_BUILD__) return;
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
      : benchmarkModeLabel(state?.modeOrder[Math.min(state.modeIndex, state.modeOrder.length - 1)] ?? '空闲');
    conversations.textContent = state ? String(state.conversationIds.length) : '—';
    mode.textContent = currentMode;
    progress.textContent = state ? `${state.currentSwitch} / ${state.switchesPerMode}` : `0 / ${Number(loops.value) * 10}`;
    dom.textContent = sample ? String(sample.documentDomNodes) : '—';
    heap.textContent = sample?.jsHeapMb === null || sample?.jsHeapMb === undefined ? '—' : `${sample.jsHeapMb.toFixed(1)} MB`;
    latency.textContent = sample?.switchLatencyMs === null || sample?.switchLatencyMs === undefined ? '—' : `${sample.switchLatencyMs.toFixed(1)} ms`;
    message.textContent = state?.status === 'complete'
      ? '性能测试已完成，可以导出结果。'
      : state?.status === 'stopped'
        ? '性能测试已停止。'
        : state?.status === 'failed'
          ? '性能测试失败，请导出诊断数据进一步排查。'
          : active
            ? '性能测试正在自动运行，请暂时不要操作 ChatGPT。'
            : profile.value === 'experimental'
              ? '实验配置只测试激进模式；Session GC 保持独立。'
              : '标准验证会比较 Control、均衡和极简；Hard Switch 保持关闭。';
    start.hidden = active;
    start.textContent = state && ['complete', 'stopped', 'failed'].includes(state.status) ? '开始新的性能测试' : '开始性能测试';
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
    longStressMessage.textContent = latestLongStress?.status === 'complete'
      ? '超长会话压力测试已完成。'
      : latestLongStress?.status === 'failed'
        ? '超长会话压力测试失败，请导出诊断数据进一步排查。'
        : latestLongStress
          ? `压力测试：步骤 ${Math.min(latestLongStress.stepIndex + 1, 5)} / 5 · ${latestLongStress.status}`
          : '在当前超长会话中依次测试 8 轮 / 4 轮 / 2 轮 / 1 轮 / 1 条消息。';
  };
  loops.addEventListener('change', () => {
    if (!latestState || !activeStatuses.has(latestState.status)) progress.textContent = `0 / ${Number(loops.value) * 10}`;
  });
  profile.addEventListener('change', () => render(latestState));

  start.addEventListener('click', async () => {
    message.textContent = '正在启动性能测试…';
    const requestedLoops = loops.value === '5' ? 5 : 10;
    const requestedProfile: BenchmarkProfile = profile.value === 'experimental' ? 'experimental' : 'standard';
    const response = await sendToActiveTab({ type: 'csg:benchmark-start', loops: requestedLoops, profile: requestedProfile });
    if (!response?.ok) {
      message.textContent = response?.error ?? '请打开已登录的 chatgpt.com 标签页后重试。';
      return;
    }
    await refresh();
  });
  stop.addEventListener('click', async () => { await sendToActiveTab({ type: 'csg:benchmark-stop' }); await refresh(); });
  resume.addEventListener('click', async () => { await sendToActiveTab({ type: 'csg:benchmark-resume' }); await refresh(); });
  sessionGc.addEventListener('click', async () => {
    const response = await sendToActiveTab({ type: 'csg:session-gc-start' });
    if (!response?.ok) message.textContent = response?.error ?? '无法启动 Session GC 测试。';
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
    longStressMessage.textContent = '正在启动超长会话压力测试…';
    const response = await sendToActiveTab({ type: 'csg:long-stress-start' });
    if (!response?.ok) longStressMessage.textContent = response?.error ?? '无法启动超长会话压力测试。';
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
    if (!response?.stabilityTrace) { stabilityTraceMessage.textContent = '当前标签页没有可用的窗口稳定性诊断数据。'; return; }
    const snapshot = response.stabilityTrace as { flappingDetected?: boolean };
    stabilityTraceMessage.textContent = snapshot.flappingDetected ? '检测到窗口抖动，诊断 JSON 已导出。' : '诊断 JSON 已导出。';
    downloadText('stability-trace-' + Date.now() + '.json', JSON.stringify(response.stabilityTrace, null, 2), 'application/json;charset=utf-8');
  });
  stabilityTraceReportButton.addEventListener('click', async () => {
    const response = await sendToActiveTab({ type: 'csg:stability-trace-get' });
    if (!response?.stabilityReport) { stabilityTraceMessage.textContent = '当前标签页没有可用的窗口稳定性诊断报告。'; return; }
    const snapshot = response.stabilityTrace as { flappingDetected?: boolean } | undefined;
    stabilityTraceMessage.textContent = snapshot?.flappingDetected ? '检测到窗口抖动，诊断报告已导出。' : '诊断报告已导出。';
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
  historyStatus.textContent = '正在准备更早历史…';
  const response = await sendToActiveTab({ type: 'csg:history-load-previous' });
  if (!response?.ok) historyStatus.textContent = response?.error ?? '无法加载更早历史。';
});

toggleButton.addEventListener('click', () => { void saveConfig({ ...config, enabled: !config.enabled }); });
fullHistoryButton.addEventListener('click', async () => {
  const request: PopupRequest = config.temporaryFullHistory
    ? { type: 'csg:restore-lightweight' }
    : { type: 'csg:temporary-full-history' };
  const response = await sendToActiveTab(request);
  if (!response?.ok) historyStatus.textContent = response?.error ?? '无法重新加载当前历史模式。';
});

resetStatsButton.addEventListener('click', async () => {
  const confirmed = window.confirm('确定要重置本地保护统计吗？这不会更改 Session Guard 配置。');
  if (!confirmed) return;
  resetStatsButton.disabled = true;
  statsStatus.textContent = '正在重置本地统计…';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'csg:stats-reset' }) as { ok?: boolean; state?: GuardStats } | undefined;
    if (!response?.ok || !response.state) {
      statsStatus.textContent = '重置失败，请稍后重试。';
      return;
    }
    renderStats(response.state);
    statsStatus.textContent = '本地统计已重置，Session Guard 配置未更改。';
  } catch {
    statsStatus.textContent = '重置失败，请稍后重试。';
  } finally {
    resetStatsButton.disabled = false;
  }
});

void (async () => {
  config = await loadConfig();
  renderConfig();
  const [metrics, stats] = await Promise.all([getMetrics(), loadStats()]);
  renderMetrics(metrics);
  renderStats(stats);
  setupFieldRecorderUi();
  setupBenchmarkUi();
})();
