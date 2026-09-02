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
  private globalAbort: AbortController | null = null;
  private scopeObserver: MutationObserver | null = null;
  private scopeTimer: number | null = null;
  private currentConversationId: string | null = null;
  private hasInitialNavigation = false;
  private spaSwitchCount = 0;
  private cleanupCount = 0;
  private networkMode: NetworkMode = 'unknown';
  private metrics: DebugMetrics = { ...EMPTY_METRICS };

  constructor(config: GuardConfig) {
    this.config = config;
    this.navigation = new NavigationObserver((conversationId) => this.onNavigation(conversationId));
  }

  start(): void {
    if (this.globalAbort) return;
    this.globalAbort = new AbortController();
    window.addEventListener(EVENTS.networkStatus, (event) => {
      const status = parseStringEvent<NetworkStatus>(event);
      if (!status) return;
      this.networkMode = status.mode;
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
    if (this.hasInitialNavigation) this.spaSwitchCount += 1;
    this.hasInitialNavigation = true;
    this.cleanupScope();
    this.currentConversationId = conversationId;

    if (!conversationId) {
      this.metrics = buildMetrics({
        conversationId: null,
        spaSwitchCount: this.spaSwitchCount,
        cleanupCount: this.cleanupCount,
        hardSwitchCount: this.hardSwitch.countPerformed,
        networkMode: this.networkMode,
        dom: EMPTY_DOM
      });
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
    this.metrics = buildMetrics({
      conversationId: this.currentConversationId,
      spaSwitchCount: this.spaSwitchCount,
      cleanupCount: this.cleanupCount,
      hardSwitchCount: this.hardSwitch.countPerformed,
      networkMode: this.networkMode,
      dom
    });
    this.hardSwitch.observe(this.metrics);

    if (this.hardSwitch.shouldHardReload(this.config, this.metrics)) {
      this.hardSwitch.markHardReload(this.spaSwitchCount);
      location.replace(location.href);
    }
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
