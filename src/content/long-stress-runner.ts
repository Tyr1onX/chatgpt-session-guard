import { normalizeConfig, type GuardConfig } from '../shared/config';
import {
  LONG_STRESS_SETTINGS,
  type LongStressSample,
  type LongStressState
} from '../shared/long-stress';
import type { DebugMetrics } from '../shared/types';
import { hasUnsafeInteractiveState } from './hard-switch';
import { extractConversationId } from './navigation-observer';

declare const __CSG_BUILD_ID__: string;

const STABLE_QUIET_MS = 700;
const STABLE_TIMEOUT_MS = 15_000;
const BUSY_POLL_MS = 250;

interface StressStorageResponse {
  state?: LongStressState | null;
  ok?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function loadState(): Promise<LongStressState | null> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'csg:long-stress-get' }) as StressStorageResponse | undefined;
    return response?.state ?? null;
  } catch {
    return null;
  }
}

async function saveState(state: LongStressState): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'csg:long-stress-set', state });
}

async function measureInputLatencyProxy(): Promise<number> {
  const values: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const started = performance.now();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    values.push(performance.now() - started);
  }
  values.sort((a, b) => a - b);
  return Math.round((values[2] ?? 0) * 10) / 10;
}

async function measureScrollWorkProxy(): Promise<number | null> {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('main *'))
    .filter((element) => element.scrollHeight > element.clientHeight + 40 && element.clientHeight > 100)
    .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
  const scroller = candidates[0];
  if (!scroller) return null;
  const original = scroller.scrollTop;
  const delta = original > 2 ? -1 : 1;
  const started = performance.now();
  scroller.scrollTop = original + delta;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  scroller.scrollTop = original;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return Math.round((performance.now() - started) * 10) / 10;
}

async function measureLongTasks(): Promise<{ count: number | null; blockingMs: number | null }> {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    return { count: null, blockingMs: null };
  }
  let count = 0;
  let blockingMs = 0;
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        count += 1;
        blockingMs += Math.max(0, entry.duration - 50);
      }
    });
    observer.observe({ type: 'longtask' });
    await sleep(800);
    return { count, blockingMs: Math.round(blockingMs * 10) / 10 };
  } catch {
    return { count: null, blockingMs: null };
  } finally {
    observer?.disconnect();
  }
}

export class LongConversationStressRunner {
  private state: LongStressState | null = null;

  constructor(
    private readonly getMetrics: () => DebugMetrics,
    private readonly getConfig: () => GuardConfig,
    private readonly setConfig: (config: GuardConfig) => Promise<void>,
    private readonly onState: (state: LongStressState | null) => void
  ) {}

  async initialize(): Promise<void> {
    this.state = await loadState();
    this.onState(this.state);
    if (!this.state || !['preparing', 'reloading', 'measuring'].includes(this.state.status)) return;
    if (this.state.buildId !== __CSG_BUILD_ID__) {
      await this.fail('Debug build changed during Long Conversation Stress. Start a new run.');
      return;
    }
    if (extractConversationId(location.pathname) !== this.state.conversationId) {
      await this.fail('Long Conversation Stress must remain on the conversation where it started.');
      return;
    }
    void this.resumeAfterReload();
  }

  getState(): LongStressState | null {
    return this.state ? structuredClone(this.state) : null;
  }

  async start(): Promise<{ ok: boolean; error?: string }> {
    const conversationId = extractConversationId(location.pathname);
    if (!conversationId) return { ok: false, error: 'Open a normal long ChatGPT conversation first.' };
    if (hasUnsafeInteractiveState()) return { ok: false, error: 'ChatGPT is busy. Finish the active task before starting stress test.' };
    this.state = {
      version: 1,
      status: 'preparing',
      conversationId,
      buildId: __CSG_BUILD_ID__,
      startedAt: Date.now(),
      completedAt: null,
      stepIndex: 0,
      originalConfig: this.getConfig(),
      samples: [],
      error: null
    };
    await this.persist();
    await this.applyStepAndReload();
    return { ok: true };
  }

  async stop(): Promise<void> {
    if (!this.state) return;
    this.state.status = 'stopped';
    this.state.completedAt = Date.now();
    await this.setConfig(this.state.originalConfig);
    await this.persist();
  }

  private async applyStepAndReload(): Promise<void> {
    if (!this.state) return;
    const setting = LONG_STRESS_SETTINGS[this.state.stepIndex];
    if (!setting) {
      await this.complete();
      return;
    }
    const next = normalizeConfig({
      ...this.state.originalConfig,
      enabled: true,
      mode: 'balanced',
      historyUnit: setting.historyUnit,
      historyCount: setting.historyCount,
      autoLoadHistory: false,
      historyExpansion: 0,
      historyExpansionConversationId: null,
      temporaryFullHistory: false,
      hardSwitchEnabled: false
    });
    this.state.status = 'reloading';
    await this.setConfig(next);
    await this.persist();
    window.setTimeout(() => location.reload(), 100);
  }

  private async resumeAfterReload(): Promise<void> {
    if (!this.state) return;
    while (hasUnsafeInteractiveState()) await sleep(BUSY_POLL_MS);
    this.state.status = 'measuring';
    await this.persist();
    try {
      await this.waitForStability();
      const metrics = this.getMetrics();
      const [longTasks, inputLatencyProxyMs, scrollWorkProxyMs] = await Promise.all([
        measureLongTasks(),
        measureInputLatencyProxy(),
        measureScrollWorkProxy()
      ]);
      const setting = LONG_STRESS_SETTINGS[this.state.stepIndex];
      if (!setting) throw new Error('Missing stress setting.');
      const sample: LongStressSample = {
        timestamp: Date.now(),
        label: setting.label,
        historyUnit: setting.historyUnit,
        historyCount: setting.historyCount,
        renderedMessages: metrics.renderedMessages,
        renderedRounds: metrics.renderedRounds,
        conversationDomNodes: metrics.conversationDomNodes,
        activeConversationDomNodes: metrics.activeConversationDomNodes,
        documentDomNodes: metrics.totalDocumentDomNodes,
        jsHeapMb: metrics.jsHeapMb,
        longTaskCount: longTasks.count,
        longTaskBlockingMs: longTasks.blockingMs,
        inputLatencyProxyMs,
        scrollWorkProxyMs,
        networkMode: metrics.networkMode,
        networkRequestedTurns: metrics.networkRequestedTurns,
        networkEffectiveTurns: metrics.networkEffectiveTurns,
        limitedByDomBudget: metrics.limitedByDomBudget
      };
      this.state.samples.push(sample);
      this.state.stepIndex += 1;
      await this.persist();
      await this.applyStepAndReload();
    } catch (error) {
      await this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private async waitForStability(): Promise<void> {
    const deadline = performance.now() + STABLE_TIMEOUT_MS;
    let lastSignature = '';
    let stableSince = performance.now();
    while (performance.now() < deadline) {
      const metrics = this.getMetrics();
      const signature = [
        metrics.conversationId ?? '',
        metrics.renderedMessages,
        metrics.renderedRounds,
        metrics.conversationDomNodes,
        metrics.activeConversationDomNodes
      ].join(':');
      if (signature !== lastSignature) {
        lastSignature = signature;
        stableSince = performance.now();
      }
      if (metrics.totalRounds > 0 && performance.now() - stableSince >= STABLE_QUIET_MS) return;
      await sleep(100);
    }
    throw new Error('Current conversation did not stabilize within 15 seconds.');
  }

  private async complete(): Promise<void> {
    if (!this.state) return;
    this.state.status = 'complete';
    this.state.completedAt = Date.now();
    await this.setConfig(this.state.originalConfig);
    await this.persist();
    window.setTimeout(() => location.reload(), 100);
  }

  private async fail(message: string): Promise<void> {
    if (!this.state) return;
    this.state.status = 'failed';
    this.state.error = message;
    this.state.completedAt = Date.now();
    await this.setConfig(this.state.originalConfig);
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (!this.state) return;
    await saveState(this.state);
    this.onState(structuredClone(this.state));
  }
}
