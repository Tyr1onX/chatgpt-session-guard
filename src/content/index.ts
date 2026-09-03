import {
  DEFAULT_CONFIG,
  STORAGE_KEY,
  normalizeConfig,
  persistentConfig,
  type GuardConfig
} from '../shared/config';
import { EVENTS, dispatchStringEvent, parseStringEvent, type DebugCommand, type GuardStatsEvent } from '../shared/events';
import { EMPTY_METRICS, type DebugMetrics, type PopupRequest, type PopupResponse } from '../shared/types';
import type { NetworkTraceEvent } from '../main-world/fetch-guard';
import { AutomaticBenchmarkRunner } from './benchmark-runner';
import { PassiveFieldRecorder } from './field-recorder';
import { BenchmarkStatusUi } from './benchmark-ui';
import { clearHistoryExpansion, loadHistoryExpansion, saveHistoryExpansion, type HistoryExpansionState } from './history-session';
import { hasUnsafeInteractiveState } from './hard-switch';
import { LongConversationStressRunner } from './long-stress-runner';
import { extractConversationId } from './navigation-observer';
import { SessionController } from './session-controller';
import { LocalStatsBridge } from './stats-bridge';
import { StabilityTraceCollector, stabilityTraceReport } from './stability-trace';

declare const __CSG_DEBUG_BUILD__: boolean;
declare const __CSG_FIELD_BUILD__: boolean;
declare const __CSG_BUILD_ID__: string;

let config: GuardConfig = DEFAULT_CONFIG;
let historyExpansion: HistoryExpansionState | null = null;
let controller: SessionController | null = null;
let benchmarkRunner: AutomaticBenchmarkRunner | null = null;
let benchmarkUi: BenchmarkStatusUi | null = null;
let longStressRunner: LongConversationStressRunner | null = null;
let fieldRecorder: PassiveFieldRecorder | null = null;
const statsBridge = new LocalStatsBridge();
const stabilityTrace = __CSG_DEBUG_BUILD__ ? new StabilityTraceCollector() : null;
const STABILITY_NETWORK_TRACE_EVENT = 'csg:stability-network-trace';

function currentConversationId(): string | null {
  return extractConversationId(location.pathname);
}

function runtimeConfig(): GuardConfig {
  const conversationId = currentConversationId();
  if (!historyExpansion || !conversationId || historyExpansion.conversationId !== conversationId) {
    return { ...config, historyExpansion: 0, historyExpansionConversationId: null };
  }
  return {
    ...config,
    historyExpansion: historyExpansion.amount,
    historyExpansionConversationId: historyExpansion.conversationId
  };
}

function sendConfigToMainWorld(): void {
  dispatchStringEvent(EVENTS.config, runtimeConfig());
}

function sendDebugMetrics(metrics: DebugMetrics): void {
  if (__CSG_DEBUG_BUILD__) dispatchStringEvent(EVENTS.debugMetrics, metrics);
}

async function saveConfig(next: GuardConfig): Promise<void> {
  config = normalizeConfig(persistentConfig(next));
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
  const runtime = runtimeConfig();
  dispatchStringEvent(EVENTS.config, runtime);
  controller?.updateConfig(runtime);
}

async function loadConfig(): Promise<GuardConfig> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return normalizeConfig(stored[STORAGE_KEY]);
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function loadPreviousHistory(): Promise<{ ok: boolean; error?: string }> {
  const conversationId = currentConversationId();
  if (!conversationId) return { ok: false, error: '请先打开一个正常的 ChatGPT 会话。' };
  if (hasUnsafeInteractiveState()) return { ok: false, error: 'ChatGPT 正在处理任务，请等待当前任务结束后再加载更早历史。' };

  const previous = historyExpansion?.conversationId === conversationId ? historyExpansion.amount : 0;
  historyExpansion = { conversationId, amount: Math.min(200, previous + config.historyBatchSize) };
  await saveHistoryExpansion(historyExpansion);
  const runtime = runtimeConfig();
  dispatchStringEvent(EVENTS.config, runtime);
  controller?.updateConfig(runtime);
  window.setTimeout(() => location.reload(), 80);
  return { ok: true };
}

async function enableTemporaryFullHistory(): Promise<{ ok: boolean; error?: string }> {
  if (hasUnsafeInteractiveState()) return { ok: false, error: 'ChatGPT 正在处理任务，请等待当前任务结束后再显示完整历史。' };
  historyExpansion = null;
  await clearHistoryExpansion();
  await saveConfig({ ...config, temporaryFullHistory: true });
  window.setTimeout(() => location.reload(), 80);
  return { ok: true };
}

async function restoreLightweightMode(): Promise<{ ok: boolean; error?: string }> {
  if (hasUnsafeInteractiveState()) return { ok: false, error: 'ChatGPT 正在处理任务，请等待当前任务结束后再恢复轻量模式。' };
  historyExpansion = null;
  await clearHistoryExpansion();
  await saveConfig({ ...config, temporaryFullHistory: false });
  window.setTimeout(() => location.reload(), 80);
  return { ok: true };
}

function setupHistoryEvents(): void {
  window.addEventListener(EVENTS.loadPreviousHistory, () => { void loadPreviousHistory(); });
  window.addEventListener(EVENTS.temporaryFullHistory, () => { void enableTemporaryFullHistory(); });
  window.addEventListener(EVENTS.navigation, () => {
    const conversationId = currentConversationId();
    if (!historyExpansion || historyExpansion.conversationId === conversationId) return;
    historyExpansion = null;
    void clearHistoryExpansion();
    const runtime = runtimeConfig();
    dispatchStringEvent(EVENTS.config, runtime);
    controller?.updateConfig(runtime);
  });
}

function setupStatsEvents(): void {
  window.addEventListener(EVENTS.stats, (event) => {
    const statsEvent = parseStringEvent<GuardStatsEvent>(event);
    if (!statsEvent) return;
    statsBridge.recordEvent(statsEvent);
    fieldRecorder?.recordStatsEvent(statsEvent.type);
  });
}

function setupStabilityTrace(): void {
  if (!__CSG_DEBUG_BUILD__ || !stabilityTrace) return;
  window.addEventListener(STABILITY_NETWORK_TRACE_EVENT, (event) => {
    const trace = parseStringEvent<NetworkTraceEvent>(event);
    if (trace) stabilityTrace.addNetwork(trace);
  });
}

function setupDebugCommands(): void {
  if (!__CSG_DEBUG_BUILD__) return;
  window.addEventListener(EVENTS.debugCommand, (event) => {
    const command = parseStringEvent<DebugCommand>(event);
    if (!command || command.type !== 'set-hard-switch' || typeof command.enabled !== 'boolean') return;
    void saveConfig({ ...config, hardSwitchEnabled: command.enabled });
  });
}

function setupBenchmark(): void {
  if (!__CSG_DEBUG_BUILD__ || __CSG_FIELD_BUILD__ || !controller) return;
  benchmarkUi = new BenchmarkStatusUi(
    () => { void benchmarkRunner?.stop(); },
    () => { void benchmarkRunner?.resume(); },
    () => { void benchmarkRunner?.startSessionGc(); }
  );
  benchmarkRunner = new AutomaticBenchmarkRunner(
    () => controller?.getMetrics() ?? { ...EMPTY_METRICS },
    () => runtimeConfig(),
    saveConfig,
    (state) => benchmarkUi?.render(state)
  );
  void benchmarkRunner.initialize();
  longStressRunner = new LongConversationStressRunner(
    () => controller?.getMetrics() ?? { ...EMPTY_METRICS },
    () => runtimeConfig(),
    saveConfig,
    () => undefined
  );
  void longStressRunner.initialize();
}

function setupRuntimeMessages(): void {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const request = message as Partial<PopupRequest>;
    if (request.type === 'csg:get-state') {
      const response: PopupResponse = {
        metrics: controller?.getMetrics() ?? { ...EMPTY_METRICS },
        benchmark: __CSG_DEBUG_BUILD__ ? benchmarkRunner?.getState() ?? null : null,
        longStress: __CSG_DEBUG_BUILD__ ? longStressRunner?.getState() ?? null : null
      };
      sendResponse(response);
      return false;
    }

    if (request.type === 'csg:history-load-previous') {
      void loadPreviousHistory().then((result) => sendResponse(result));
      return true;
    }
    if (request.type === 'csg:temporary-full-history') {
      void enableTemporaryFullHistory().then((result) => sendResponse(result));
      return true;
    }
    if (request.type === 'csg:restore-lightweight') {
      void restoreLightweightMode().then((result) => sendResponse(result));
      return true;
    }

    if (__CSG_FIELD_BUILD__ && request.type === 'csg:field-status') {
      void fieldRecorder?.status().then((fieldStatus) => sendResponse({ ok: true, fieldStatus }));
      return true;
    }
    if (__CSG_FIELD_BUILD__ && request.type === 'csg:field-reset') {
      void fieldRecorder?.reset().then(() => fieldRecorder?.status()).then((fieldStatus) => sendResponse({ ok: true, fieldStatus }));
      return true;
    }

    if (__CSG_DEBUG_BUILD__ && request.type === 'csg:stability-trace-get') {
      const snapshot = stabilityTrace?.snapshot() ?? null;
      sendResponse({
        ok: true,
        stabilityTrace: snapshot,
        stabilityReport: snapshot ? stabilityTraceReport(snapshot) : null
      });
      return false;
    }

    if (!__CSG_DEBUG_BUILD__ || !benchmarkRunner) return false;
    if (request.type === 'csg:benchmark-start') {
      const stress = longStressRunner?.getState();
      if (stress && ['preparing', 'reloading', 'measuring'].includes(stress.status)) {
        sendResponse({ ok: false, error: '超长会话压力测试正在运行。' });
        return false;
      }
      const loops = request.loops === 5 ? 5 : 10;
      const profile = request.profile === 'experimental' ? 'experimental' : 'standard';
      void (async () => {
        historyExpansion = null;
        await clearHistoryExpansion();
        const result = await benchmarkRunner.start(loops, profile);
        sendResponse(result);
      })();
      return true;
    }
    if (request.type === 'csg:benchmark-stop') {
      void benchmarkRunner.stop().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (request.type === 'csg:benchmark-resume') {
      void benchmarkRunner.resume().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (request.type === 'csg:session-gc-start') {
      void benchmarkRunner.startSessionGc().then((result) => sendResponse(result));
      return true;
    }
    if (request.type === 'csg:long-stress-start') {
      const benchmark = benchmarkRunner.getState();
      if (benchmark && ['preparing', 'reloading', 'running', 'paused-busy', 'paused-user', 'retrying'].includes(benchmark.status)) {
        sendResponse({ ok: false, error: '自动切换性能测试正在运行。' });
        return false;
      }
      if (!longStressRunner) { sendResponse({ ok: false, error: '超长会话压力测试当前不可用。' }); return false; }
      void (async () => {
        historyExpansion = null;
        await clearHistoryExpansion();
        const result = await longStressRunner?.start() ?? { ok: false, error: '超长会话压力测试当前不可用。' };
        sendResponse(result);
      })();
      return true;
    }
    if (request.type === 'csg:long-stress-stop') {
      if (!longStressRunner) { sendResponse({ ok: false }); return false; }
      void longStressRunner.stop().then(() => sendResponse({ ok: true }));
      return true;
    }
    return false;
  });
}

async function init(): Promise<void> {
  window.addEventListener(EVENTS.requestConfig, sendConfigToMainWorld);
  setupDebugCommands();
  setupStatsEvents();
  setupStabilityTrace();
  setupHistoryEvents();

  config = await loadConfig();
  historyExpansion = await loadHistoryExpansion();
  sendConfigToMainWorld();

  controller = new SessionController(
    runtimeConfig(),
    (metrics) => {
      statsBridge.observeMetrics(metrics);
      sendDebugMetrics(metrics);
      fieldRecorder?.notifyEvaluation();
    },
    (__CSG_DEBUG_BUILD__ || __CSG_FIELD_BUILD__) ? (event) => {
      if (__CSG_DEBUG_BUILD__) stabilityTrace?.addSession(event);
      if (__CSG_FIELD_BUILD__) fieldRecorder?.recordSessionTrace(event);
    } : undefined,
    (conversationId, dom) => statsBridge.observeEvaluation(conversationId, dom)
  );
  if (__CSG_FIELD_BUILD__) {
    fieldRecorder = new PassiveFieldRecorder({
      buildId: __CSG_BUILD_ID__,
      storage: chrome.storage.local,
      getConfig: runtimeConfig,
      getMetrics: () => controller?.getMetrics() ?? { ...EMPTY_METRICS }
    });
    fieldRecorder.start();
  }
  controller.start();
  setupBenchmark();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
    config = normalizeConfig(changes[STORAGE_KEY]?.newValue);
    const runtime = runtimeConfig();
    dispatchStringEvent(EVENTS.config, runtime);
    controller?.updateConfig(runtime);
  });

  setupRuntimeMessages();

  window.addEventListener('pagehide', () => {
    benchmarkRunner?.destroy();
    fieldRecorder?.destroy();
    controller?.destroy();
    statsBridge.destroy();
  }, { once: true });
}

void init();
