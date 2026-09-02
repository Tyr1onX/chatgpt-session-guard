import {
  BENCHMARK_MODES,
  analyzeMode,
  benchmarkTargets,
  emptyModeResult,
  emptySessionGcResult,
  preliminaryConclusion,
  type BenchmarkMode,
  type BenchmarkSample,
  type BenchmarkState
} from '../shared/benchmark';
import type { GuardConfig } from '../shared/config';
import { EVENTS } from '../shared/events';
import type { DebugMetrics } from '../shared/types';
import { hasUnsafeInteractiveState } from './hard-switch';
import { extractConversationId } from './navigation-observer';
import { loadBenchmarkState, saveBenchmarkState } from './benchmark-storage';

declare const __CSG_BUILD_ID__: string;

const MAX_SWITCH_RETRIES = 2;
const ROUTE_TIMEOUT_MS = 10_000;
const STABLE_QUIET_MS = 700;
const STABLE_TIMEOUT_MS = 15_000;
const BUSY_POLL_MS = 250;
const USER_PAUSE_SELECTOR = '[data-csg-benchmark-ui]';

export interface BenchmarkStartResult {
  ok: boolean;
  error?: string;
}

interface LongTaskSnapshot {
  count: number | null;
  blockingMs: number | null;
}

class LongTaskTracker {
  private observer: PerformanceObserver | null = null;
  private count = 0;
  private blockingMs = 0;
  private supported = false;

  start(): void {
    this.stop();
    this.count = 0;
    this.blockingMs = 0;
    this.supported = typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes?.includes('longtask') === true;
    if (!this.supported) return;
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.count += 1;
          this.blockingMs += Math.max(0, entry.duration - 50);
        }
      });
      this.observer.observe({ type: 'longtask' });
    } catch {
      this.supported = false;
      this.observer = null;
    }
  }

  snapshot(): LongTaskSnapshot {
    return this.supported
      ? { count: this.count, blockingMs: Math.round(this.blockingMs * 10) / 10 }
      : { count: null, blockingMs: null };
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function currentConversationId(): string | null {
  return extractConversationId(location.pathname);
}

function conversationIdFromHref(href: string): string | null {
  try {
    return extractConversationId(new URL(href, location.href).pathname);
  } catch {
    return null;
  }
}

export function collectSidebarConversationIds(root: ParentNode = document, limit = 5): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const anchors = root.querySelectorAll<HTMLAnchorElement>(
    'nav a[href], aside a[href], [data-testid*="sidebar" i] a[href]'
  );
  for (const anchor of anchors) {
    const id = conversationIdFromHref(anchor.href);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

function findConversationAnchor(conversationId: string): HTMLAnchorElement | null {
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('nav a[href], aside a[href], [data-testid*="sidebar" i] a[href]')) {
    if (conversationIdFromHref(anchor.href) === conversationId) return anchor;
  }
  return null;
}

function benchmarkConfig(mode: BenchmarkMode, original: GuardConfig): GuardConfig {
  if (mode === 'control') {
    return {
      ...original,
      enabled: false,
      temporaryFullHistory: false,
      hardSwitchEnabled: false,
      debug: true
    };
  }
  return {
    ...original,
    enabled: true,
    mode,
    temporaryFullHistory: false,
    hardSwitchEnabled: false,
    debug: true
  };
}

function isActiveStatus(status: BenchmarkState['status']): boolean {
  return ['preparing', 'reloading', 'running', 'paused-busy', 'paused-user', 'retrying'].includes(status);
}

export class AutomaticBenchmarkRunner {
  private state: BenchmarkState | null = null;
  private runGeneration = 0;
  private readonly longTasks = new LongTaskTracker();
  private readonly abortController = new AbortController();
  private lastObservedConversationId: string | null = currentConversationId();

  constructor(
    private readonly getMetrics: () => DebugMetrics,
    private readonly getConfig: () => GuardConfig,
    private readonly setConfig: (config: GuardConfig) => Promise<void>,
    private readonly onState: (state: BenchmarkState | null) => void
  ) {
    document.addEventListener('pointerdown', (event) => this.onTrustedUserInput(event), {
      capture: true,
      signal: this.abortController.signal
    });
    document.addEventListener('keydown', (event) => this.onTrustedUserInput(event), {
      capture: true,
      signal: this.abortController.signal
    });
    document.addEventListener('wheel', (event) => this.onTrustedUserInput(event), {
      capture: true,
      passive: true,
      signal: this.abortController.signal
    });
    window.addEventListener(EVENTS.navigation, () => this.onNavigation(), { signal: this.abortController.signal });
  }

  async initialize(): Promise<void> {
    this.state = await loadBenchmarkState();
    this.onState(this.state);
    if (!this.state || !isActiveStatus(this.state.status)) return;

    if (this.state.environment.buildId !== __CSG_BUILD_ID__) {
      this.state.status = 'failed';
      this.state.pauseReason = `Benchmark build changed from ${this.state.environment.buildId} to ${__CSG_BUILD_ID__}; start a new benchmark so results are not mixed across builds.`;
      this.state.conclusion = 'inconclusive';
      this.state.conclusionReason = this.state.pauseReason;
      this.state.completedAt = Date.now();
      await this.setConfig(this.state.originalConfig);
      await this.persist();
      return;
    }

    if (this.isPausedByUser()) return;
    const generation = ++this.runGeneration;
    if (this.state.phase === 'session-gc') void this.resumeSessionGcAfterReload(generation);
    else void this.resumeAfterReload(generation);
  }

  getState(): BenchmarkState | null {
    return this.state ? structuredClone(this.state) : null;
  }

  async start(loops: 5 | 10): Promise<BenchmarkStartResult> {
    if (this.state && isActiveStatus(this.state.status)) {
      return { ok: false, error: 'A benchmark is already running.' };
    }

    const conversationIds = collectSidebarConversationIds(document, 5);
    if (conversationIds.length < 5) {
      return {
        ok: false,
        error: `Automatic benchmark needs at least 5 visible /c/{conversationId} links in the ChatGPT sidebar; found ${conversationIds.length}.`
      };
    }

    const startedAt = Date.now();
    const originalConfig = this.getConfig();
    this.state = {
      version: 1,
      sessionId: `${startedAt}-${Math.random().toString(36).slice(2, 10)}`,
      status: 'preparing',
      phase: 'primary',
      pauseReason: null,
      startedAt,
      completedAt: null,
      loops,
      switchesPerMode: loops * 10,
      conversationIds,
      modeOrder: [...BENCHMARK_MODES],
      modeIndex: 0,
      currentSwitch: 0,
      expectedConversationId: null,
      retryCount: 0,
      originalConfig,
      environment: {
        userAgent: navigator.userAgent,
        buildId: __CSG_BUILD_ID__,
        startedAt,
        conversationCount: conversationIds.length,
        switchesPerMode: loops * 10,
        loops,
        rendererMemory: 'not-collected'
      },
      results: {
        control: emptyModeResult('control'),
        balanced: emptyModeResult('balanced'),
        aggressive: emptyModeResult('aggressive')
      },
      sessionGc: null,
      sessionGcPendingStartedAt: null,
      sessionGcPendingTarget: null,
      conclusion: null,
      conclusionReason: null
    };
    await this.persist();
    window.setTimeout(() => { void this.prepareCurrentMode(); }, 80);
    return { ok: true };
  }

  async startSessionGc(): Promise<BenchmarkStartResult> {
    if (!this.state || this.state.status !== 'complete') {
      return { ok: false, error: 'Complete the Control/Balanced/Aggressive benchmark first.' };
    }
    if (this.state.results.aggressive.analysis?.spaRetainedStateLikely !== true) {
      return { ok: false, error: 'Session GC benchmark is only recommended when Aggressive keeps DOM stable while heap still shows strong growth.' };
    }
    this.state.phase = 'session-gc';
    this.state.status = 'preparing';
    this.state.pauseReason = null;
    this.state.completedAt = null;
    this.state.currentSwitch = 0;
    this.state.expectedConversationId = null;
    this.state.retryCount = 0;
    this.state.sessionGc = emptySessionGcResult();
    this.state.sessionGcPendingStartedAt = null;
    this.state.sessionGcPendingTarget = null;
    await this.persist();
    window.setTimeout(() => { void this.prepareSessionGc(); }, 80);
    return { ok: true };
  }

  async stop(): Promise<void> {
    if (!this.state || !isActiveStatus(this.state.status)) return;
    this.runGeneration += 1;
    this.longTasks.stop();
    this.state.status = 'stopped';
    this.state.pauseReason = 'Stopped by user.';
    this.state.expectedConversationId = null;
    await this.setConfig(this.state.originalConfig);
    await this.persist();
    if (!hasUnsafeInteractiveState()) window.setTimeout(() => location.reload(), 150);
  }

  async resume(): Promise<void> {
    if (!this.state || this.state.status !== 'paused-user') return;
    if (this.state.phase === 'session-gc') {
      this.state.sessionGc = emptySessionGcResult();
      this.state.currentSwitch = 0;
      this.state.expectedConversationId = null;
      this.state.retryCount = 0;
      this.state.pauseReason = null;
      await this.persist();
      await this.prepareSessionGc();
      return;
    }
    const mode = this.state.modeOrder[this.state.modeIndex];
    if (!mode) return;
    this.state.results[mode] = emptyModeResult(mode);
    this.state.currentSwitch = 0;
    this.state.expectedConversationId = null;
    this.state.retryCount = 0;
    this.state.pauseReason = null;
    await this.persist();
    await this.prepareCurrentMode();
  }

  destroy(): void {
    this.runGeneration += 1;
    this.longTasks.stop();
    this.abortController.abort();
  }

  private async prepareCurrentMode(): Promise<void> {
    const state = this.state;
    if (!state) return;
    const mode = state.modeOrder[state.modeIndex];
    if (!mode) return;

    this.runGeneration += 1;
    const generation = this.runGeneration;
    this.longTasks.stop();
    if (!(await this.waitUntilSafe(generation))) return;
    state.status = 'preparing';
    state.pauseReason = null;
    state.currentSwitch = 0;
    state.expectedConversationId = null;
    state.retryCount = 0;
    state.results[mode] = emptyModeResult(mode);
    await this.setConfig(benchmarkConfig(mode, state.originalConfig));

    const baselineConversation = state.conversationIds[4];
    if (!baselineConversation) {
      await this.failBenchmark('Missing baseline conversation E.');
      return;
    }
    state.status = 'reloading';
    state.expectedConversationId = baselineConversation;
    await this.persist();

    const targetPath = `/c/${encodeURIComponent(baselineConversation)}`;
    if (currentConversationId() === baselineConversation) location.reload();
    else location.replace(targetPath);
  }

  private async prepareSessionGc(): Promise<void> {
    const state = this.state;
    if (!state || state.phase !== 'session-gc' || !state.sessionGc) return;
    this.runGeneration += 1;
    const generation = this.runGeneration;
    this.longTasks.stop();
    if (!(await this.waitUntilSafe(generation))) return;
    state.status = 'preparing';
    state.pauseReason = null;
    state.currentSwitch = 0;
    state.expectedConversationId = null;
    state.retryCount = 0;
    state.sessionGcPendingStartedAt = null;
    state.sessionGcPendingTarget = null;
    await this.setConfig({
      ...benchmarkConfig('aggressive', state.originalConfig),
      hardSwitchEnabled: false
    });

    const baselineConversation = state.conversationIds[4];
    if (!baselineConversation) {
      await this.failBenchmark('Missing baseline conversation E for Session GC benchmark.');
      return;
    }
    state.status = 'reloading';
    state.expectedConversationId = baselineConversation;
    await this.persist();
    if (currentConversationId() === baselineConversation) location.reload();
    else location.replace(`/c/${encodeURIComponent(baselineConversation)}`);
  }

  private async resumeSessionGcAfterReload(generation: number): Promise<void> {
    const state = this.state;
    if (!state || state.phase !== 'session-gc' || !state.sessionGc || generation !== this.runGeneration) return;
    const pendingTarget = state.sessionGcPendingTarget;
    const pendingStartedAt = state.sessionGcPendingStartedAt;

    if (pendingTarget && pendingStartedAt !== null) {
      if (currentConversationId() !== pendingTarget) {
        state.expectedConversationId = pendingTarget;
        await this.persist();
        location.replace(`/c/${encodeURIComponent(pendingTarget)}`);
        return;
      }
      if (!(await this.waitUntilSafe(generation))) return;
      try {
        await this.waitForStability(pendingTarget, generation);
      } catch (error) {
        await this.failSessionGc(`Session GC reload stabilization failed: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      if (!this.state || !this.state.sessionGc || generation !== this.runGeneration) return;
      this.longTasks.start();
      this.lastObservedConversationId = pendingTarget;
      const latency = Math.max(0, Date.now() - pendingStartedAt);
      this.state.sessionGc.switchLatenciesMs.push(latency);
      this.state.currentSwitch += 1;
      this.state.sessionGc.completedSwitches = this.state.currentSwitch;
      this.state.sessionGc.hardReloadCount += 1;
      this.state.sessionGcPendingStartedAt = null;
      this.state.sessionGcPendingTarget = null;
      this.state.expectedConversationId = null;
      this.state.status = 'running';
      if (this.state.currentSwitch % 10 === 0 || this.state.currentSwitch === this.state.switchesPerMode) {
        this.recordSample(this.state.currentSwitch, latency);
      }
      await this.persist();
      await this.runSessionGcSwitches(generation);
      return;
    }

    const baselineConversation = state.conversationIds[4];
    if (!baselineConversation) {
      await this.failSessionGc('Missing baseline conversation E after Session GC reload.');
      return;
    }
    if (currentConversationId() !== baselineConversation) {
      state.expectedConversationId = baselineConversation;
      await this.persist();
      location.replace(`/c/${encodeURIComponent(baselineConversation)}`);
      return;
    }
    if (!(await this.waitUntilSafe(generation))) return;
    try {
      await this.waitForStability(baselineConversation, generation);
    } catch (error) {
      await this.failSessionGc(`Session GC baseline stabilization failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!this.state || !this.state.sessionGc || generation !== this.runGeneration) return;
    this.longTasks.start();
    this.lastObservedConversationId = baselineConversation;
    this.state.currentSwitch = 0;
    this.state.expectedConversationId = null;
    this.recordSample(0, null);
    this.state.status = 'running';
    await this.persist();
    await this.runSessionGcSwitches(generation);
  }

  private async resumeAfterReload(generation: number): Promise<void> {
    const state = this.state;
    if (!state || generation !== this.runGeneration) return;
    if (state.status === 'paused-busy') state.status = 'reloading';

    if (state.status === 'preparing' || state.status === 'reloading') {
      const baselineConversation = state.conversationIds[4];
      if (!baselineConversation) {
        await this.failBenchmark('Missing baseline conversation E after reload.');
        return;
      }
      if (currentConversationId() !== baselineConversation) {
        state.expectedConversationId = baselineConversation;
        await this.persist();
        location.replace(`/c/${encodeURIComponent(baselineConversation)}`);
        return;
      }

      if (!(await this.waitUntilSafe(generation))) return;
      try {
        await this.waitForStability(baselineConversation, generation);
      } catch (error) {
        await this.failCurrentMode(`Baseline stabilization failed: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      if (!this.state || generation !== this.runGeneration) return;
      this.longTasks.start();
      this.lastObservedConversationId = baselineConversation;
      this.state.currentSwitch = 0;
      this.state.expectedConversationId = null;
      this.recordSample(0, null);
      this.state.status = 'running';
      await this.persist();
    } else if (state.status === 'retrying') {
      state.status = 'running';
      await this.persist();
    }

    await this.runSwitches(generation);
  }

  private async runSessionGcSwitches(generation: number): Promise<void> {
    const state = this.state;
    if (!state || state.phase !== 'session-gc' || !state.sessionGc || generation !== this.runGeneration) return;
    const targets = benchmarkTargets(state.conversationIds, state.loops);
    if (targets.length !== state.switchesPerMode) {
      await this.failSessionGc('Could not build the Session GC switch sequence.');
      return;
    }

    while (this.state && this.state.phase === 'session-gc' && this.state.sessionGc && generation === this.runGeneration && this.state.currentSwitch < targets.length) {
      if (this.isPausedByUser()) return;
      if (!(await this.waitUntilSafe(generation))) return;
      const target = targets[this.state.currentSwitch];
      if (!target) break;
      const nextSwitch = this.state.currentSwitch + 1;

      if (nextSwitch % 30 === 0) {
        await this.performControlledSessionGc(target);
        return;
      }

      let succeeded = false;
      let finalError = '';
      const switchStartedAt = performance.now();
      for (let attempt = 0; attempt <= MAX_SWITCH_RETRIES; attempt += 1) {
        if (!this.state || !this.state.sessionGc || generation !== this.runGeneration || this.isPausedByUser()) return;
        this.state.retryCount = attempt;
        this.state.status = attempt === 0 ? 'running' : 'retrying';
        await this.persist();
        try {
          const latency = await this.performSwitch(target, generation, switchStartedAt, attempt > 0);
          if (!this.state || !this.state.sessionGc || generation !== this.runGeneration) return;
          this.state.sessionGc.switchLatenciesMs.push(latency);
          this.lastObservedConversationId = target;
          this.state.currentSwitch += 1;
          this.state.sessionGc.completedSwitches = this.state.currentSwitch;
          this.state.expectedConversationId = null;
          this.state.retryCount = 0;
          this.state.status = 'running';
          if (this.state.currentSwitch % 10 === 0 || this.state.currentSwitch === targets.length) {
            this.recordSample(this.state.currentSwitch, latency);
          }
          await this.persist();
          succeeded = true;
          break;
        } catch (error) {
          finalError = error instanceof Error ? error.message : String(error);
          if (!this.state || generation !== this.runGeneration || this.isPausedByUser()) return;
          if (attempt < MAX_SWITCH_RETRIES) await sleep(400);
        }
      }

      if (!succeeded) {
        await this.failSessionGc(`Session GC switch ${this.state.currentSwitch + 1} failed after ${MAX_SWITCH_RETRIES + 1} attempts: ${finalError}`);
        return;
      }
    }

    if (this.state?.sessionGc && generation === this.runGeneration && this.state.currentSwitch >= targets.length) {
      await this.completeSessionGc();
    }
  }

  private async performControlledSessionGc(targetConversationId: string): Promise<void> {
    const state = this.state;
    if (!state || state.phase !== 'session-gc' || !state.sessionGc) return;
    if (currentConversationId() === targetConversationId) {
      await this.failSessionGc('Controlled Session GC target was already active; refusing to count a no-op reload as a conversation switch.');
      return;
    }
    const snapshot = this.longTasks.snapshot();
    if (snapshot.count !== null) state.sessionGc.longTaskCountCarry += snapshot.count;
    if (snapshot.blockingMs !== null) state.sessionGc.longTaskBlockingCarryMs += snapshot.blockingMs;
    this.longTasks.stop();
    state.status = 'reloading';
    state.pauseReason = 'Running controlled Session GC.';
    state.expectedConversationId = targetConversationId;
    state.sessionGcPendingStartedAt = Date.now();
    state.sessionGcPendingTarget = targetConversationId;
    await this.persist();
    location.replace(`/c/${encodeURIComponent(targetConversationId)}`);
  }

  private async completeSessionGc(): Promise<void> {
    const state = this.state;
    if (!state || !state.sessionGc) return;
    this.longTasks.stop();
    state.sessionGc.analysis = analyzeMode(state.sessionGc);
    const controlAnalysis = state.results.control.analysis;
    const sessionGcAnalysis = state.sessionGc.analysis;
    const controlHeapGrowth = controlAnalysis?.heap.level === 'strong growth' || controlAnalysis?.heap.level === 'moderate growth';
    if (state.results.aggressive.analysis?.spaRetainedStateLikely && controlHeapGrowth && state.sessionGc.errors.length === 0) {
      if (sessionGcAnalysis.heap.level === 'stable') {
        state.conclusion = 'proven improvement';
        state.conclusionReason = 'Aggressive exposed retained SPA heap growth, while controlled Session GC kept the Session GC run heap stable and periodically recreated the renderer.';
      } else if (sessionGcAnalysis.heap.level === 'moderate growth') {
        state.conclusion = 'partial improvement';
        state.conclusionReason = 'Controlled Session GC reduced retained heap growth but did not produce a fully stable heap working set.';
      }
    }
    state.status = 'complete';
    state.pauseReason = null;
    state.completedAt = Date.now();
    state.expectedConversationId = null;
    state.sessionGcPendingStartedAt = null;
    state.sessionGcPendingTarget = null;
    await this.setConfig(state.originalConfig);
    await this.persist();
    this.runGeneration += 1;
    window.setTimeout(() => location.reload(), 180);
  }

  private async failSessionGc(message: string): Promise<void> {
    const state = this.state;
    if (!state || !state.sessionGc) return;
    this.longTasks.stop();
    state.sessionGc.errors.push(message);
    state.sessionGc.analysis = analyzeMode(state.sessionGc);
    state.status = 'complete';
    state.pauseReason = message;
    state.completedAt = Date.now();
    state.expectedConversationId = null;
    state.sessionGcPendingStartedAt = null;
    state.sessionGcPendingTarget = null;
    await this.setConfig(state.originalConfig);
    await this.persist();
  }

  private async runSwitches(generation: number): Promise<void> {
    const state = this.state;
    if (!state || generation !== this.runGeneration || state.status === 'paused-user') return;
    const targets = benchmarkTargets(state.conversationIds, state.loops);
    if (targets.length !== state.switchesPerMode) {
      await this.failBenchmark('Could not build the requested switch sequence.');
      return;
    }

    while (this.state && generation === this.runGeneration && this.state.currentSwitch < targets.length) {
      if (this.isPausedByUser()) return;
      if (!(await this.waitUntilSafe(generation))) return;
      const target = targets[this.state.currentSwitch];
      if (!target) break;

      let succeeded = false;
      let finalError = '';
      const switchStartedAt = performance.now();
      for (let attempt = 0; attempt <= MAX_SWITCH_RETRIES; attempt += 1) {
        if (!this.state || generation !== this.runGeneration || this.isPausedByUser()) return;
        this.state.retryCount = attempt;
        this.state.status = attempt === 0 ? 'running' : 'retrying';
        await this.persist();
        try {
          const latency = await this.performSwitch(target, generation, switchStartedAt, attempt > 0);
          if (!this.state || generation !== this.runGeneration) return;
          const mode = this.state.modeOrder[this.state.modeIndex];
          if (!mode) return;
          this.state.results[mode].switchLatenciesMs.push(latency);
          this.lastObservedConversationId = target;
          this.state.currentSwitch += 1;
          this.state.results[mode].completedSwitches = this.state.currentSwitch;
          this.state.expectedConversationId = null;
          this.state.retryCount = 0;
          this.state.status = 'running';
          if (this.state.currentSwitch % 10 === 0 || this.state.currentSwitch === targets.length) {
            this.recordSample(this.state.currentSwitch, latency);
          }
          await this.persist();
          succeeded = true;
          break;
        } catch (error) {
          finalError = error instanceof Error ? error.message : String(error);
          if (!this.state || generation !== this.runGeneration || this.isPausedByUser()) return;
          if (attempt < MAX_SWITCH_RETRIES) await sleep(400);
        }
      }

      if (!succeeded) {
        await this.failCurrentMode(`Switch ${this.state.currentSwitch + 1} failed after ${MAX_SWITCH_RETRIES + 1} attempts: ${finalError}`);
        return;
      }
    }

    if (this.state && generation === this.runGeneration && this.state.currentSwitch >= targets.length) {
      await this.completeCurrentMode();
    }
  }

  private async performSwitch(
    targetConversationId: string,
    generation: number,
    startedAt: number,
    allowAlreadyActive: boolean
  ): Promise<number> {
    if (!this.state || generation !== this.runGeneration) throw new Error('Benchmark cancelled.');
    const alreadyActive = currentConversationId() === targetConversationId;
    if (alreadyActive && !allowAlreadyActive) {
      throw new Error(`Target ${targetConversationId} is already active; benchmark only counts real route changes.`);
    }

    this.state.expectedConversationId = targetConversationId;
    await this.persist();

    if (!alreadyActive) {
      const anchor = findConversationAnchor(targetConversationId);
      if (!anchor) throw new Error(`Sidebar link for ${targetConversationId} is no longer available.`);
      anchor.click();
      await this.waitForRoute(targetConversationId, generation);
    }

    if (!(await this.waitUntilSafe(generation))) throw new Error('Benchmark paused.');
    await this.waitForStability(targetConversationId, generation);
    return Math.round((performance.now() - startedAt) * 10) / 10;
  }

  private async waitForRoute(targetConversationId: string, generation: number): Promise<void> {
    const deadline = performance.now() + ROUTE_TIMEOUT_MS;
    while (performance.now() < deadline) {
      if (!this.state || generation !== this.runGeneration) throw new Error('Benchmark cancelled.');
      if (this.isPausedByUser()) throw new Error('Benchmark paused by user activity.');
      if (currentConversationId() === targetConversationId) return;
      await sleep(50);
    }
    throw new Error(`Timed out waiting for route /c/${targetConversationId}.`);
  }

  private async waitForStability(targetConversationId: string, generation: number): Promise<void> {
    const deadline = performance.now() + STABLE_TIMEOUT_MS;
    let stableSince = performance.now();
    let lastSignature = '';

    while (performance.now() < deadline) {
      if (!this.state || generation !== this.runGeneration) throw new Error('Benchmark cancelled.');
      if (this.isPausedByUser()) throw new Error('Benchmark paused by user activity.');
      if (currentConversationId() !== targetConversationId) throw new Error('Route changed unexpectedly during stabilization.');
      if (hasUnsafeInteractiveState()) {
        if (!(await this.waitUntilSafe(generation))) throw new Error('Benchmark paused.');
        stableSince = performance.now();
        lastSignature = '';
      }

      const metrics = this.getMetrics();
      const signature = [
        metrics.conversationId ?? '',
        metrics.totalRounds,
        metrics.renderedRounds,
        metrics.conversationDomNodes,
        metrics.activeConversationDomNodes
      ].join(':');
      if (signature !== lastSignature) {
        lastSignature = signature;
        stableSince = performance.now();
      }

      if (
        metrics.conversationId === targetConversationId &&
        metrics.totalRounds > 0 &&
        performance.now() - stableSince >= STABLE_QUIET_MS
      ) {
        return;
      }
      await sleep(100);
    }
    throw new Error(`Conversation ${targetConversationId} did not stabilize within ${STABLE_TIMEOUT_MS / 1000}s.`);
  }

  private async waitUntilSafe(generation: number): Promise<boolean> {
    if (!this.state || generation !== this.runGeneration) return false;
    if (!hasUnsafeInteractiveState()) {
      if (this.state.status === 'paused-busy') {
        this.state.status = 'running';
        this.state.pauseReason = null;
        await this.persist();
      }
      return true;
    }

    this.state.status = 'paused-busy';
    this.state.pauseReason = 'Benchmark paused because ChatGPT is busy.';
    await this.persist();
    while (this.state && generation === this.runGeneration && hasUnsafeInteractiveState()) {
      if (this.isPausedByUser()) return false;
      await sleep(BUSY_POLL_MS);
    }
    if (!this.state || generation !== this.runGeneration || this.isPausedByUser()) return false;
    this.state.status = 'running';
    this.state.pauseReason = null;
    await this.persist();
    return true;
  }

  private recordSample(switchCount: number, switchLatencyMs: number | null): void {
    const state = this.state;
    if (!state) return;
    const metrics = this.getMetrics();
    const longTask = this.longTasks.snapshot();

    if (state.phase === 'session-gc') {
      const result = state.sessionGc;
      if (!result) return;
      const sample: BenchmarkSample = {
        timestamp: Date.now(),
        mode: 'session-gc',
        switchCount,
        conversationId: metrics.conversationId,
        renderedRounds: metrics.renderedRounds,
        conversationDomNodes: metrics.conversationDomNodes,
        documentDomNodes: metrics.totalDocumentDomNodes,
        cleanupCount: metrics.cleanupCount,
        hardSwitchCount: result.hardReloadCount,
        networkMode: metrics.networkMode,
        networkRequestedTurns: metrics.networkRequestedTurns,
        networkEffectiveTurns: metrics.networkEffectiveTurns,
        jsHeapMb: metrics.jsHeapMb,
        switchLatencyMs,
        longTaskCount: longTask.count === null ? null : result.longTaskCountCarry + longTask.count,
        longTaskBlockingMs: longTask.blockingMs === null ? null : Math.round((result.longTaskBlockingCarryMs + longTask.blockingMs) * 10) / 10,
        route: location.pathname
      };
      result.samples.push(sample);
      return;
    }

    const mode = state.modeOrder[state.modeIndex];
    if (!mode) return;
    const sample: BenchmarkSample = {
      timestamp: Date.now(),
      mode,
      switchCount,
      conversationId: metrics.conversationId,
      renderedRounds: metrics.renderedRounds,
      conversationDomNodes: metrics.conversationDomNodes,
      documentDomNodes: metrics.totalDocumentDomNodes,
      cleanupCount: metrics.cleanupCount,
      hardSwitchCount: metrics.hardSwitchCount,
      networkMode: metrics.networkMode,
      networkRequestedTurns: metrics.networkRequestedTurns,
      networkEffectiveTurns: metrics.networkEffectiveTurns,
      jsHeapMb: metrics.jsHeapMb,
      switchLatencyMs,
      longTaskCount: longTask.count,
      longTaskBlockingMs: longTask.blockingMs,
      route: location.pathname
    };
    state.results[mode].samples.push(sample);
  }

  private async completeCurrentMode(): Promise<void> {
    const state = this.state;
    if (!state) return;
    this.longTasks.stop();
    const mode = state.modeOrder[state.modeIndex];
    if (!mode) return;
    state.results[mode].analysis = analyzeMode(state.results[mode]);
    state.modeIndex += 1;
    state.currentSwitch = 0;
    state.retryCount = 0;
    state.expectedConversationId = null;
    await this.persist();

    if (state.modeIndex < state.modeOrder.length) {
      await this.prepareCurrentMode();
      return;
    }

    const conclusion = preliminaryConclusion(state.results);
    state.conclusion = conclusion.conclusion;
    state.conclusionReason = conclusion.reason;
    state.status = 'complete';
    state.pauseReason = null;
    state.completedAt = Date.now();
    await this.setConfig(state.originalConfig);
    await this.persist();
    this.runGeneration += 1;
    window.setTimeout(() => location.reload(), 180);
  }

  private async failCurrentMode(message: string): Promise<void> {
    const state = this.state;
    if (!state) return;
    this.longTasks.stop();
    const mode = state.modeOrder[state.modeIndex];
    if (!mode) {
      await this.failBenchmark(message);
      return;
    }
    state.results[mode].errors.push(message);
    state.results[mode].analysis = analyzeMode(state.results[mode]);
    state.modeIndex += 1;
    state.currentSwitch = 0;
    state.retryCount = 0;
    state.expectedConversationId = null;
    await this.persist();
    if (state.modeIndex < state.modeOrder.length) {
      await this.prepareCurrentMode();
      return;
    }
    const conclusion = preliminaryConclusion(state.results);
    state.conclusion = conclusion.conclusion;
    state.conclusionReason = conclusion.reason;
    state.status = 'complete';
    state.completedAt = Date.now();
    await this.setConfig(state.originalConfig);
    await this.persist();
    window.setTimeout(() => location.reload(), 180);
  }

  private async failBenchmark(message: string): Promise<void> {
    if (!this.state) return;
    this.runGeneration += 1;
    this.longTasks.stop();
    this.state.status = 'failed';
    this.state.pauseReason = message;
    this.state.conclusion = 'inconclusive';
    this.state.conclusionReason = message;
    this.state.completedAt = Date.now();
    await this.setConfig(this.state.originalConfig);
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (!this.state) return;
    await saveBenchmarkState(this.state);
    this.onState(structuredClone(this.state));
  }

  private onTrustedUserInput(event: Event): void {
    if (!event.isTrusted || !this.state || !['running', 'retrying'].includes(this.state.status)) return;
    const target = event.target;
    if (target instanceof Element && target.closest(USER_PAUSE_SELECTOR)) return;
    void this.pauseForUser('Benchmark paused because user activity was detected.');
  }

  private onNavigation(): void {
    if (!this.state || !['running', 'retrying', 'paused-busy'].includes(this.state.status)) return;
    const actual = currentConversationId();
    const expected = this.state.expectedConversationId;
    if (expected) {
      if (actual === expected) return;
      void this.pauseForUser('Benchmark paused because ChatGPT navigated outside the expected benchmark route.');
      return;
    }
    if (actual === this.lastObservedConversationId) return;
    void this.pauseForUser('Benchmark paused because ChatGPT navigated outside the expected benchmark route.');
  }

  private isPausedByUser(): boolean {
    return this.state?.status === 'paused-user';
  }

  private async pauseForUser(reason: string): Promise<void> {
    if (!this.state || this.isPausedByUser()) return;
    this.runGeneration += 1;
    this.state.status = 'paused-user';
    this.state.pauseReason = reason;
    await this.persist();
  }
}
