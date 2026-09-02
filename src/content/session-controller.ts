import type { GuardConfig } from '../shared/config';
import { EVENTS, parseStringEvent, type NetworkStatus, type NetworkMode } from '../shared/events';
import { EMPTY_METRICS, type DebugMetrics } from '../shared/types';
import {
  DomRollingWindow,
  findConversationObserveRoot,
  mutationChangesGenerationControl,
  mutationNeedsConversationEvaluate,
  type DomWindowStats
} from './dom-window';
import { HardSwitchGuard } from './hard-switch';
import { buildMetrics } from './metrics';
import { NavigationObserver } from './navigation-observer';

const EMPTY_DOM: DomWindowStats = {
  totalRounds: 0,
  renderedRounds: 0,
  totalMessages: 0,
  renderedMessages: 0,
  conversationDomNodes: 0,
  activeConversationDomNodes: 0,
  hiddenRounds: 0,
  prunedTurns: 0,
  configuredHistoryCount: 0,
  historyUnit: 'round',
  limitedByDomBudget: false,
  boundaryIndex: 0,
  boundaryTurnId: null,
  lastVisibleUserIndex: -1,
  generationActive: false
};

export type EvaluateReason =
  | 'navigation'
  | 'same-conversation-navigation'
  | 'conversation-topology'
  | 'network-status'
  | 'config-update';

export interface SessionTraceEvent {
  timestamp: number;
  conversationId: string | null;
  navigationEpoch: number;
  type: 'navigation' | 'evaluate' | 'observer';
  reason?: EvaluateReason;
  sameConversation?: boolean;
  evaluateDurationMs?: number;
  observerMutationCount?: number;
  ignoredExtensionMutationCount?: number;
  dom?: DomWindowStats;
  cleanupCount: number;
  visualRestoreCount: number;
  pathname: string;
  queryKeys: string[];
  scrollHeight?: number;
}

export class SessionController {
  private config: GuardConfig;
  private readonly domWindow = new DomRollingWindow();
  private readonly hardSwitch = new HardSwitchGuard();
  private readonly navigation: NavigationObserver;
  private readonly onMetrics: ((metrics: DebugMetrics) => void) | undefined;
  private readonly onTrace: ((event: SessionTraceEvent) => void) | undefined;
  private globalAbort: AbortController | null = null;
  private scopeObserver: MutationObserver | null = null;
  private scopeTimer: number | null = null;
  private currentConversationId: string | null = null;
  private hasInitialNavigation = false;
  private navigationEpoch = 0;
  private spaSwitchCount = 0;
  private cleanupCount = 0;
  private visualRestoreCount = 0;
  private ignoredExtensionMutationCount = 0;
  private lastGenerationActive = false;
  private networkMode: NetworkMode = 'unknown';
  private networkModified = false;
  private networkRequestedTurns: number | null = null;
  private networkEffectiveTurns: number | null = null;
  private pendingNavigationStartedAt: number | null = null;
  private lastSwitchLatencyMs: number | null = null;
  private metrics: DebugMetrics = { ...EMPTY_METRICS };

  constructor(
    config: GuardConfig,
    onMetrics?: (metrics: DebugMetrics) => void,
    onTrace?: (event: SessionTraceEvent) => void
  ) {
    this.config = config;
    this.onMetrics = onMetrics;
    this.onTrace = onTrace;
    this.navigation = new NavigationObserver(
      (conversationId) => this.onNavigation(conversationId),
      () => this.onSameConversationMutation()
    );
  }

  start(): void {
    if (this.globalAbort) return;
    this.globalAbort = new AbortController();
    window.addEventListener(EVENTS.networkStatus, (event) => {
      const status = parseStringEvent<NetworkStatus>(event);
      if (!status) return;
      this.networkMode = status.mode;
      this.networkModified = status.modified;
      this.networkRequestedTurns = status.requestedTurns ?? null;
      this.networkEffectiveTurns = status.effectiveTurns ?? null;
      this.scheduleEvaluate(0, 'network-status');
    }, { signal: this.globalAbort.signal });
    this.navigation.start();
  }

  updateConfig(config: GuardConfig): void {
    const shouldRestoreVisualState = (this.config.enabled && !config.enabled) ||
      (!this.config.temporaryFullHistory && config.temporaryFullHistory);
    this.config = config;
    if (shouldRestoreVisualState) {
      this.domWindow.restoreAllVisualState();
      this.visualRestoreCount += 1;
    }
    this.scheduleEvaluate(0, 'config-update');
  }

  getMetrics(): DebugMetrics {
    return { ...this.metrics };
  }

  destroy(): void {
    this.navigation.destroy();
    this.cleanupScope();
    this.globalAbort?.abort();
    this.globalAbort = null;
  }

  private onSameConversationMutation(): void {
    this.trace({ type: 'navigation', sameConversation: true });
    this.scheduleEvaluate(0, 'same-conversation-navigation');
  }

  private onNavigation(conversationId: string | null): void {
    const previousConversationId = this.currentConversationId;
    const sameConversation = this.hasInitialNavigation && previousConversationId === conversationId;
    if (sameConversation) {
      this.scheduleEvaluate(0, 'same-conversation-navigation');
      return;
    }

    this.navigationEpoch += 1;
    this.pendingNavigationStartedAt = performance.now();
    if (this.hasInitialNavigation) this.spaSwitchCount += 1;
    this.hasInitialNavigation = true;
    this.cleanupScope();
    this.currentConversationId = conversationId;
    this.networkMode = this.config.enabled && !this.config.temporaryFullHistory ? 'unknown' : 'disabled';
    this.networkModified = false;
    this.networkRequestedTurns = null;
    this.networkEffectiveTurns = null;
    this.trace({ type: 'navigation', sameConversation: false });

    if (!conversationId) {
      this.lastSwitchLatencyMs = this.consumeSwitchLatency();
      this.metrics = buildMetrics({
        conversationId: null,
        spaSwitchCount: this.spaSwitchCount,
        cleanupCount: this.cleanupCount,
        hardSwitchCount: this.hardSwitch.countPerformed,
        networkMode: this.networkMode,
        networkModified: this.networkModified,
        networkRequestedTurns: this.networkRequestedTurns,
        networkEffectiveTurns: this.networkEffectiveTurns,
        switchLatencyMs: this.lastSwitchLatencyMs,
        dom: EMPTY_DOM
      });
      this.publishMetrics();
      return;
    }

    this.installScopeObserver();
    this.scheduleEvaluate(0, 'navigation');
  }

  private installScopeObserver(): void {
    this.scopeObserver?.disconnect();
    const epoch = this.navigationEpoch;
    this.scopeObserver = new MutationObserver((records) => {
      if (epoch !== this.navigationEpoch) return;
      const relevant = mutationNeedsConversationEvaluate(records);
      if (!relevant) {
        const ignoredOwned = records.filter((record) => {
          const target = record.target instanceof Element ? record.target : record.target.parentElement;
          return target?.closest('[data-csg-owned="true"], #csg-history-placeholder, #csg-window-styles') !== null;
        }).length;
        this.ignoredExtensionMutationCount += ignoredOwned;
        this.trace({
          type: 'observer',
          observerMutationCount: records.length,
          ignoredExtensionMutationCount: ignoredOwned
        });
        return;
      }
      this.trace({ type: 'observer', observerMutationCount: records.length, ignoredExtensionMutationCount: 0 });
      const settleDelay = this.lastGenerationActive && mutationChangesGenerationControl(records) ? 250 : 80;
      this.scheduleEvaluate(settleDelay, 'conversation-topology');
    });
    this.scopeObserver.observe(findConversationObserveRoot(), { childList: true, subtree: true });
  }

  private scheduleEvaluate(delay = 80, reason: EvaluateReason = 'conversation-topology'): void {
    if (!this.currentConversationId || this.scopeTimer !== null) return;
    const taskEpoch = this.navigationEpoch;
    this.scopeTimer = window.setTimeout(() => {
      this.scopeTimer = null;
      if (taskEpoch !== this.navigationEpoch) return;
      this.evaluate(reason, taskEpoch);
    }, delay);
  }

  private evaluate(reason: EvaluateReason, taskEpoch: number): void {
    if (taskEpoch !== this.navigationEpoch) return;
    const started = performance.now();
    const dom = this.domWindow.apply(this.config, this.currentConversationId);
    const duration = Math.round((performance.now() - started) * 100) / 100;
    this.lastGenerationActive = dom.generationActive;
    const switchLatency = this.consumeSwitchLatency();
    if (switchLatency !== null) this.lastSwitchLatencyMs = switchLatency;
    this.metrics = buildMetrics({
      conversationId: this.currentConversationId,
      spaSwitchCount: this.spaSwitchCount,
      cleanupCount: this.cleanupCount,
      hardSwitchCount: this.hardSwitch.countPerformed,
      networkMode: this.networkMode,
      networkModified: this.networkModified,
      networkRequestedTurns: this.networkRequestedTurns,
      networkEffectiveTurns: this.networkEffectiveTurns,
      switchLatencyMs: this.lastSwitchLatencyMs,
      dom
    });
    this.publishMetrics();
    this.trace({ type: 'evaluate', reason, evaluateDurationMs: duration, dom, scrollHeight: document.documentElement.scrollHeight });
    this.hardSwitch.observe(this.metrics);

    if (this.hardSwitch.shouldHardReload(this.config, this.metrics)) {
      this.hardSwitch.markHardReload(this.spaSwitchCount);
      location.replace(location.href);
    }
  }

  private consumeSwitchLatency(): number | null {
    if (this.pendingNavigationStartedAt === null) return null;
    const latency = Math.round((performance.now() - this.pendingNavigationStartedAt) * 10) / 10;
    this.pendingNavigationStartedAt = null;
    return latency;
  }

  private publishMetrics(): void {
    this.onMetrics?.({ ...this.metrics });
  }

  private trace(partial: Omit<SessionTraceEvent, 'timestamp' | 'conversationId' | 'navigationEpoch' | 'cleanupCount' | 'visualRestoreCount' | 'pathname' | 'queryKeys'>): void {
    this.onTrace?.({
      timestamp: Date.now(),
      conversationId: this.currentConversationId,
      navigationEpoch: this.navigationEpoch,
      cleanupCount: this.cleanupCount,
      visualRestoreCount: this.visualRestoreCount,
      pathname: location.pathname,
      queryKeys: [...new URL(location.href).searchParams.keys()].sort(),
      ...partial
    });
  }

  private cleanupScope(): void {
    const hadScope = this.scopeObserver !== null || this.scopeTimer !== null || this.currentConversationId !== null;
    this.scopeObserver?.disconnect();
    this.scopeObserver = null;
    if (this.scopeTimer !== null) {
      window.clearTimeout(this.scopeTimer);
      this.scopeTimer = null;
    }
    this.domWindow.cleanupForNavigation();
    if (hadScope) this.cleanupCount += 1;
  }
}
