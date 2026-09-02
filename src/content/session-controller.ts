import type { GuardConfig } from '../shared/config';
import { EVENTS, parseStringEvent, type NetworkStatus, type NetworkMode } from '../shared/events';
import { EMPTY_METRICS, type DebugMetrics } from '../shared/types';
import { DomRollingWindow, type DomWindowStats } from './dom-window';
import { HardSwitchGuard } from './hard-switch';
import { buildMetrics } from './metrics';
import { NavigationObserver } from './navigation-observer';

const EMPTY_DOM: DomWindowStats = {
  totalRounds: 0,
  renderedRounds: 0,
  conversationDomNodes: 0,
  activeConversationDomNodes: 0,
  hiddenRounds: 0,
  prunedTurns: 0
};

export class SessionController {
  private config: GuardConfig;
  private readonly domWindow = new DomRollingWindow();
  private readonly hardSwitch = new HardSwitchGuard();
  private readonly navigation: NavigationObserver;
  private readonly onMetrics: ((metrics: DebugMetrics) => void) | undefined;
  private globalAbort: AbortController | null = null;
  private scopeObserver: MutationObserver | null = null;
  private scopeTimer: number | null = null;
  private currentConversationId: string | null = null;
  private hasInitialNavigation = false;
  private spaSwitchCount = 0;
  private cleanupCount = 0;
  private networkMode: NetworkMode = 'unknown';
  private networkModified = false;
  private networkRequestedTurns: number | null = null;
  private networkEffectiveTurns: number | null = null;
  private pendingNavigationStartedAt: number | null = null;
  private lastSwitchLatencyMs: number | null = null;
  private metrics: DebugMetrics = { ...EMPTY_METRICS };

  constructor(config: GuardConfig, onMetrics?: (metrics: DebugMetrics) => void) {
    this.config = config;
    this.onMetrics = onMetrics;
    this.navigation = new NavigationObserver((conversationId) => this.onNavigation(conversationId));
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
      this.scheduleEvaluate();
    }, { signal: this.globalAbort.signal });
    this.navigation.start();
  }

  updateConfig(config: GuardConfig): void {
    this.config = config;
    this.scheduleEvaluate(0);
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

  private onNavigation(conversationId: string | null): void {
    this.pendingNavigationStartedAt = performance.now();
    if (this.hasInitialNavigation) this.spaSwitchCount += 1;
    this.hasInitialNavigation = true;
    this.cleanupScope();
    this.currentConversationId = conversationId;
    this.networkMode = this.config.enabled && !this.config.temporaryFullHistory ? 'unknown' : 'disabled';
    this.networkModified = false;
    this.networkRequestedTurns = null;
    this.networkEffectiveTurns = null;

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

    this.scopeObserver = new MutationObserver(() => this.scheduleEvaluate());
    this.scopeObserver.observe(document.documentElement, { childList: true, subtree: true });
    this.scheduleEvaluate(0);
  }

  private scheduleEvaluate(delay = 80): void {
    if (!this.currentConversationId || this.scopeTimer !== null) return;
    this.scopeTimer = window.setTimeout(() => {
      this.scopeTimer = null;
      this.evaluate();
    }, delay);
  }

  private evaluate(): void {
    const dom = this.domWindow.apply(this.config);
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

  private cleanupScope(): void {
    const hadScope = this.scopeObserver !== null || this.scopeTimer !== null || this.currentConversationId !== null;
    this.scopeObserver?.disconnect();
    this.scopeObserver = null;
    if (this.scopeTimer !== null) {
      window.clearTimeout(this.scopeTimer);
      this.scopeTimer = null;
    }
    this.domWindow.cleanup();
    if (hadScope) this.cleanupCount += 1;
  }
}
