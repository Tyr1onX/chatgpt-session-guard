import {
  benchmarkFilename,
  benchmarkReport,
  type BenchmarkMode,
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
import {
  resolveLocale,
  translate,
  type LanguagePreference,
  type Locale,
  type MessageKey
} from './i18n';
import {
  DEFAULT_UI_PREFERENCES,
  loadUiPreferences,
  saveUiPreferences,
  type PreferenceStorage,
  type UiPreferences
} from './ui-preferences';

declare const __CSG_DEBUG_BUILD__: boolean;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing popup element: ${id}`);
  return found as T;
}

const appName = element<HTMLElement>('appName');
const modeLabel = element<HTMLElement>('modeLabel');
const modeSelect = element<HTMLSelectElement>('mode');
const modeDescription = element<HTMLElement>('modeDescription');
const modeBadge = element<HTMLElement>('modeBadge');
const ultraLiteNotice = element<HTMLElement>('ultraLiteNotice');
const historyTitle = element<HTMLElement>('historyTitle');
const visibleHistoryLabel = element<HTMLElement>('visibleHistoryLabel');
const historyPreset = element<HTMLSelectElement>('historyPreset');
const historyCustom = element<HTMLElement>('historyCustom');
const historyUnit = element<HTMLSelectElement>('historyUnit');
const historyCount = element<HTMLInputElement>('historyCount');
const historyExplanation = element<HTMLElement>('historyExplanation');
const olderHistoryLabel = element<HTMLElement>('olderHistoryLabel');
const autoLoadHistory = element<HTMLSelectElement>('autoLoadHistory');
const historyBatchSize = element<HTMLSelectElement>('historyBatchSize');
const loadPreviousHistory = element<HTMLButtonElement>('loadPreviousHistory');
const fullHistoryButton = element<HTMLButtonElement>('fullHistory');
const fullHistoryHint = element<HTMLElement>('fullHistoryHint');
const historyStatus = element<HTMLElement>('historyStatus');
const toggleButton = element<HTMLButtonElement>('toggleEnabled');
const statusText = element<HTMLElement>('statusText');
const statusDot = element<HTMLElement>('statusDot');
const sessionLabel = element<HTMLElement>('sessionLabel');
const sessionState = element<HTMLElement>('sessionState');
const sessionHelp = element<HTMLElement>('sessionHelp');
const sessionHelpText = element<HTMLElement>('sessionHelpText');
const reloadPageButton = element<HTMLButtonElement>('reloadPage');
const activeHistoryLabel = element<HTMLElement>('activeHistoryLabel');
const activeHistory = element<HTMLElement>('activeHistory');
const domBudgetLabel = element<HTMLElement>('domBudgetLabel');
const domBudgetState = element<HTMLElement>('domBudgetState');
const networkGuardLabel = element<HTMLElement>('networkGuardLabel');
const networkGuardState = element<HTMLElement>('networkGuardState');
const domStrategyLabel = element<HTMLElement>('domStrategyLabel');
const domStrategyState = element<HTMLElement>('domStrategyState');
const hardSwitchLabel = element<HTMLElement>('hardSwitchLabel');
const hardSwitchState = element<HTMLElement>('hardSwitchState');
const advancedSummary = element<HTMLElement>('advancedSummary');
const loadBatchLabel = element<HTMLElement>('loadBatchLabel');
const technicalMetricsTitle = element<HTMLElement>('technicalMetricsTitle');
const warning = element<HTMLElement>('warning');
const metricsList = element<HTMLDListElement>('metrics');
const languageLabel = element<HTMLElement>('languageLabel');
const languageSelect = element<HTMLSelectElement>('language');

const preferenceStorage: PreferenceStorage = {
  get: async (key) => chrome.storage.local.get(key),
  set: async (items) => chrome.storage.local.set(items)
};

let config: GuardConfig = DEFAULT_CONFIG;
let uiPreferences: UiPreferences = DEFAULT_UI_PREFERENCES;
let locale: Locale = 'en';
let latestMetrics: DebugMetrics | null = null;
let refreshBenchmarkUi: (() => Promise<void>) | null = null;

function t(key: MessageKey, variables: Record<string, string | number> = {}): string {
  return translate(locale, key, variables);
}

function setText(id: string, key: MessageKey): void {
  element<HTMLElement>(id).textContent = t(key);
}

function setOptionText(select: HTMLSelectElement, value: string, key: MessageKey): void {
  const option = Array.from(select.options).find((item) => item.value === value);
  if (option) option.textContent = t(key);
}

async function loadConfig(): Promise<GuardConfig> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeConfig(stored[STORAGE_KEY]);
}

async function saveConfig(next: GuardConfig): Promise<void> {
  config = normalizeConfig(persistentConfig(next));
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
  renderConfig();
  renderMetrics(latestMetrics);
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

async function reloadActiveTab(): Promise<void> {
  const tab = await activeTab();
  if (typeof tab?.id !== 'number') return;
  try {
    await chrome.tabs.reload(tab.id);
  } catch {
    // Keep the no-extra-permission UX fail-safe: the text instruction remains visible.
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

function modeDescriptionKey(mode: GuardMode): MessageKey {
  if (mode === 'safe') return 'modeSafeDescription';
  if (mode === 'ultra-lite') return 'modeUltraLiteUsage';
  if (mode === 'aggressive') return 'modeAggressiveDescription';
  return 'modeBalancedDescription';
}

function benchmarkModeName(mode: BenchmarkMode | 'session-gc' | null): string {
  if (mode === 'control') return t('control');
  if (mode === 'balanced') return t('modeBalanced');
  if (mode === 'ultra-lite') return t('modeUltraLite');
  if (mode === 'aggressive') return t('modeAggressive');
  if (mode === 'session-gc') return 'Session GC';
  return t('idle');
}

function historyUnitText(unit: HistoryUnit, count: number): string {
  if (locale === 'zh-CN') return unit === 'message' ? `${count} 条消息` : `${count} 轮对话`;
  const noun = unit === 'message' ? (count === 1 ? 'message' : 'messages') : (count === 1 ? 'round' : 'rounds');
  return `${count} ${noun}`;
}

function applyStaticTranslations(): void {
  document.documentElement.lang = locale;
  document.title = t('appName');
  appName.textContent = t('appName');
  modeLabel.textContent = t('mode');
  historyTitle.textContent = t('history');
  visibleHistoryLabel.textContent = t('visibleHistory');
  olderHistoryLabel.textContent = t('olderHistory');
  sessionLabel.textContent = t('session');
  activeHistoryLabel.textContent = t('activeHistory');
  domBudgetLabel.textContent = t('domBudget');
  networkGuardLabel.textContent = t('networkGuard');
  domStrategyLabel.textContent = t('domStrategy');
  hardSwitchLabel.textContent = t('hardSwitch');
  advancedSummary.textContent = t('advancedSettings');
  loadBatchLabel.textContent = t('loadBatch');
  technicalMetricsTitle.textContent = t('technicalMetrics');
  fullHistoryHint.textContent = t('fullHistoryHint');
  sessionHelpText.textContent = t('sessionUnavailableHelp');
  reloadPageButton.textContent = t('reloadPage');
  languageLabel.textContent = t('language');

  setOptionText(modeSelect, 'safe', 'modeSafe');
  setOptionText(modeSelect, 'balanced', 'modeBalanced');
  setOptionText(modeSelect, 'ultra-lite', 'modeUltraLite');
  setOptionText(modeSelect, 'aggressive', 'modeAggressive');
  setOptionText(historyPreset, 'message:1', 'historyOneMessage');
  setOptionText(historyPreset, 'round:1', 'historyOneRound');
  setOptionText(historyPreset, 'round:2', 'historyRounds2');
  setOptionText(historyPreset, 'round:4', 'historyRounds4');
  setOptionText(historyPreset, 'round:8', 'historyRounds8');
  setOptionText(historyPreset, 'round:16', 'historyRounds16');
  setOptionText(historyPreset, 'custom', 'custom');
  setOptionText(historyUnit, 'message', 'messages');
  setOptionText(historyUnit, 'round', 'rounds');
  setOptionText(autoLoadHistory, 'false', 'manualOnly');
  setOptionText(autoLoadHistory, 'true', 'automatic');
  setOptionText(languageSelect, 'auto', 'languageAuto');
  setOptionText(languageSelect, 'zh-CN', 'languageChinese');
  setOptionText(languageSelect, 'en', 'languageEnglish');

  historyUnit.setAttribute('aria-label', t('visibleHistory'));
  historyCount.setAttribute('aria-label', t('visibleHistory'));

  if (__CSG_DEBUG_BUILD__) {
    setText('debugToolsLabel', 'debugTools');
    setText('debugBadge', 'debug');
    setText('benchmarkTitle', 'benchmark');
    setText('benchmarkProfileLabel', 'benchmarkProfile');
    setText('benchmarkConversationsLabel', 'conversations');
    setText('benchmarkModeLabel', 'benchmarkMode');
    setText('benchmarkProgressLabel', 'progress');
    setText('benchmarkDomLabel', 'dom');
    setText('benchmarkHeapLabel', 'heap');
    setText('benchmarkLatencyLabel', 'latency');
    setText('benchmarkLoopsLabel', 'runLength');
    setText('longStressTitle', 'longStress');
    setOptionText(element<HTMLSelectElement>('benchmarkProfile'), 'standard', 'benchmarkStandard');
    setOptionText(element<HTMLSelectElement>('benchmarkProfile'), 'experimental', 'benchmarkExperimental');
    setOptionText(element<HTMLSelectElement>('benchmarkLoops'), '10', 'switches100');
    setOptionText(element<HTMLSelectElement>('benchmarkLoops'), '5', 'switches50');
    element<HTMLButtonElement>('benchmarkResume').textContent = t('resumeBenchmark');
    element<HTMLButtonElement>('benchmarkStop').textContent = t('stopBenchmark');
    element<HTMLButtonElement>('benchmarkJson').textContent = t('downloadJson');
    element<HTMLButtonElement>('benchmarkReport').textContent = t('downloadReport');
    element<HTMLButtonElement>('benchmarkSessionGc').textContent = t('sessionGcBenchmark');
    element<HTMLButtonElement>('longStressStart').textContent = t('runLongStress');
    element<HTMLButtonElement>('longStressStop').textContent = t('stop');
    element<HTMLButtonElement>('longStressJson').textContent = t('stressJson');
    element<HTMLButtonElement>('longStressReport').textContent = t('stressReport');
  }
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

  statusText.textContent = `${t('status')} · ${t(config.enabled ? 'enabled' : 'disabled')}`;
  statusDot.classList.toggle('off', !config.enabled);
  toggleButton.textContent = t(config.enabled ? 'disable' : 'enable');
  fullHistoryButton.textContent = t(config.temporaryFullHistory ? 'restoreLightweightMode' : 'temporaryFullHistory');
  loadPreviousHistory.textContent = t('loadPrevious', { count: config.historyBatchSize });
  warning.textContent = t('modeAggressiveDescription');
  warning.hidden = config.mode !== 'aggressive';
  modeBadge.textContent = t('modeUltraLiteBadge');
  modeBadge.hidden = config.mode !== 'ultra-lite';
  modeDescription.textContent = t(modeDescriptionKey(config.mode));
  historyExplanation.textContent = t(config.historyUnit === 'message' ? 'messageExplanation' : 'roundExplanation');
  domBudgetState.textContent = t('domBudgetAuto', { value: Math.round(config.domBudget / 1000) });
  hardSwitchState.textContent = t(config.hardSwitchEnabled ? 'on' : 'off');
  domStrategyState.textContent = t(config.mode === 'aggressive'
    ? 'domStrategyAggressive'
    : config.mode === 'safe'
      ? 'domStrategySafe'
      : 'domStrategyBalanced');
  languageSelect.value = uiPreferences.language;
}

function renderMetrics(metrics: DebugMetrics | null): void {
  latestMetrics = metrics;
  metricsList.replaceChildren();

  if (!metrics) {
    sessionState.textContent = t('sessionUnavailable');
    activeHistory.textContent = t('noValue');
    networkGuardState.textContent = config.enabled && !config.temporaryFullHistory ? t('networkGuardUnavailable') : t('off');
    sessionHelp.hidden = false;
    return;
  }

  sessionHelp.hidden = true;
  if (!metrics.conversationId) sessionState.textContent = t('sessionNoChat');
  else if (metrics.activeConversationDomNodes <= config.domBudget) sessionState.textContent = t('sessionClean');
  else sessionState.textContent = t('sessionPressure');

  const active = metrics.historyUnit === 'message' ? metrics.renderedMessages : metrics.renderedRounds;
  activeHistory.textContent = `${historyUnitText(metrics.historyUnit, active)} / ${historyUnitText(metrics.historyUnit, metrics.configuredHistoryCount)}${metrics.limitedByDomBudget ? ` · ${t('budgetLimited')}` : ''}`;

  if (!config.enabled) networkGuardState.textContent = t('off');
  else if (config.temporaryFullHistory) networkGuardState.textContent = t('networkGuardTemporaryOff');
  else networkGuardState.textContent = t('networkGuardOn');

  const rows: Array<[MessageKey, string]> = [
    ['metricConversationId', metrics.conversationId ?? t('noValue')],
    ['metricSpaSwitches', String(metrics.spaSwitchCount)],
    ['metricRenderedRounds', `${metrics.renderedRounds} / ${metrics.totalRounds}`],
    ['metricRenderedMessages', `${metrics.renderedMessages} / ${metrics.totalMessages}`],
    ['metricHistoryTarget', `${historyUnitText(metrics.historyUnit, metrics.configuredHistoryCount)}${metrics.limitedByDomBudget ? ` · ${t('budgetLimited')}` : ''}`],
    ['metricConversationDom', String(metrics.conversationDomNodes)],
    ['metricActiveDom', String(metrics.activeConversationDomNodes)],
    ['metricDocumentDom', String(metrics.totalDocumentDomNodes)],
    ['metricNetworkGuard', metrics.networkMode],
    ['metricNetworkTurns', metrics.networkRequestedTurns === null ? t('nA') : `${metrics.networkRequestedTurns} → ${metrics.networkEffectiveTurns ?? metrics.networkRequestedTurns}`],
    ['metricCleanupCount', String(metrics.cleanupCount)],
    ['metricHardSwitches', String(metrics.hardSwitchCount)],
    ['metricSwitchLatency', metrics.switchLatencyMs === null ? t('nA') : `${metrics.switchLatencyMs} ms`],
    ['metricJsHeap', metrics.jsHeapMb === null ? t('nA') : `${metrics.jsHeapMb} MB`]
  ];

  for (const [key, value] of rows) {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = t(key);
    dd.textContent = value;
    metricsList.append(dt, dd);
  }
}

function applyLocale(): void {
  locale = resolveLocale(uiPreferences.language);
  applyStaticTranslations();
  renderConfig();
  renderMetrics(latestMetrics);
  void refreshBenchmarkUi?.();
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
  let latestLongStress: LongStressState | null = null;
  let latestState: BenchmarkState | null = null;

  const activeStatuses = new Set(['preparing', 'reloading', 'running', 'paused-busy', 'paused-user', 'retrying']);

  const render = (state: BenchmarkState | null): void => {
    latestState = state;
    const sample = state ? currentBenchmarkSample(state) : null;
    const active = state ? activeStatuses.has(state.status) : false;
    const currentMode = state?.phase === 'session-gc'
      ? 'session-gc'
      : state?.modeOrder[Math.min(state.modeIndex, state.modeOrder.length - 1)] ?? null;
    conversations.textContent = state ? String(state.conversationIds.length) : t('noValue');
    mode.textContent = benchmarkModeName(currentMode);
    progress.textContent = state ? `${state.currentSwitch} / ${state.switchesPerMode}` : `0 / ${Number(loops.value) * 10}`;
    dom.textContent = sample ? String(sample.documentDomNodes) : t('noValue');
    heap.textContent = sample?.jsHeapMb === null || sample?.jsHeapMb === undefined ? t('noValue') : `${sample.jsHeapMb.toFixed(1)} MB`;
    latency.textContent = sample?.switchLatencyMs === null || sample?.switchLatencyMs === undefined ? t('noValue') : `${sample.switchLatencyMs.toFixed(1)} ms`;
    message.textContent = state?.pauseReason ?? (
      state?.status === 'complete'
        ? t('benchmarkComplete', { result: state.conclusion ?? 'inconclusive' })
        : state?.status === 'stopped'
          ? t('benchmarkStopped')
          : active
            ? t('benchmarkRunningMessage')
            : profile.value === 'experimental'
              ? t('benchmarkExperimentalMessage')
              : t('benchmarkStandardMessage')
    );
    start.hidden = active;
    start.textContent = state && ['complete', 'stopped', 'failed'].includes(state.status) ? t('startNewBenchmark') : t('startBenchmark');
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
        ? t('longStressComplete')
        : t('longStressStep', { step: Math.min(latestLongStress.stepIndex + 1, 5), status: latestLongStress.status }))
      : t('longStressDescription');
  };
  refreshBenchmarkUi = refresh;

  loops.addEventListener('change', () => {
    if (!latestState || !activeStatuses.has(latestState.status)) progress.textContent = `0 / ${Number(loops.value) * 10}`;
  });
  profile.addEventListener('change', () => render(latestState));

  start.addEventListener('click', async () => {
    message.textContent = t('startingBenchmark');
    const requestedLoops = loops.value === '5' ? 5 : 10;
    const requestedProfile: BenchmarkProfile = profile.value === 'experimental' ? 'experimental' : 'standard';
    const response = await sendToActiveTab({ type: 'csg:benchmark-start', loops: requestedLoops, profile: requestedProfile });
    if (!response?.ok) {
      message.textContent = response?.error ?? t('openLoggedInChat');
      return;
    }
    await refresh();
  });
  stop.addEventListener('click', async () => { await sendToActiveTab({ type: 'csg:benchmark-stop' }); await refresh(); });
  resume.addEventListener('click', async () => { await sendToActiveTab({ type: 'csg:benchmark-resume' }); await refresh(); });
  sessionGc.addEventListener('click', async () => {
    const response = await sendToActiveTab({ type: 'csg:session-gc-start' });
    if (!response?.ok) message.textContent = response?.error ?? t('unableSessionGc');
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
    longStressMessage.textContent = t('startingLongStress');
    const response = await sendToActiveTab({ type: 'csg:long-stress-start' });
    if (!response?.ok) longStressMessage.textContent = response?.error ?? t('unableLongStress');
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

  void refresh();
  window.setInterval(() => { void refresh(); }, 500);
}

modeSelect.addEventListener('change', () => {
  const mode = modeSelect.value as GuardMode;
  let next = applyModePreset(config, mode);
  if (config.mode === 'ultra-lite' && mode === 'balanced' && config.historyUnit === 'round' && config.historyCount === 1) {
    next = normalizeConfig({ ...next, historyUnit: 'round', historyCount: 8 });
  }
  if (mode === 'ultra-lite' && !uiPreferences.ultraLiteNoticeSeen) {
    ultraLiteNotice.textContent = t('ultraLiteNotice');
    ultraLiteNotice.hidden = false;
    void (async () => {
      uiPreferences = await saveUiPreferences(preferenceStorage, { ...uiPreferences, ultraLiteNoticeSeen: true });
    })();
  } else {
    ultraLiteNotice.hidden = true;
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
  historyStatus.textContent = t('preparingOlderHistory');
  const response = await sendToActiveTab({ type: 'csg:history-load-previous' });
  if (!response?.ok) historyStatus.textContent = response?.error ?? t('unableLoadOlderHistory');
  else historyStatus.textContent = t('reloadingCurrentChat');
});

toggleButton.addEventListener('click', () => { void saveConfig({ ...config, enabled: !config.enabled }); });

fullHistoryButton.addEventListener('click', async () => {
  historyStatus.textContent = t('reloadingCurrentChat');
  const request: PopupRequest = config.temporaryFullHistory
    ? { type: 'csg:restore-lightweight' }
    : { type: 'csg:temporary-full-history' };
  const response = await sendToActiveTab(request);
  if (!response?.ok) historyStatus.textContent = response?.error ?? t('unableReloadHistoryMode');
});

reloadPageButton.addEventListener('click', () => { void reloadActiveTab(); });

languageSelect.addEventListener('change', () => {
  const requested = languageSelect.value as LanguagePreference;
  void (async () => {
    uiPreferences = await saveUiPreferences(preferenceStorage, { ...uiPreferences, language: requested });
    applyLocale();
  })();
});

void (async () => {
  [config, uiPreferences] = await Promise.all([
    loadConfig(),
    loadUiPreferences(preferenceStorage)
  ]);
  locale = resolveLocale(uiPreferences.language);
  latestMetrics = await getMetrics();
  applyStaticTranslations();
  renderConfig();
  renderMetrics(latestMetrics);
  setupBenchmarkUi();
})();
