import type { GuardStatsEvent } from '../shared/events';
import type { GuardStatsDelta } from '../shared/stats';
import type { DebugMetrics } from '../shared/types';
import type { DomWindowStats } from './dom-window';

const FLUSH_DELAY_MS = 1000;

function addDelta(target: GuardStatsDelta, key: keyof GuardStatsDelta, amount = 1): void {
  if (key === 'switchLatencySamples') return;
  const current = target[key];
  if (typeof current === 'number') {
    (target as Record<string, unknown>)[key] = current + amount;
  } else {
    (target as Record<string, unknown>)[key] = amount;
  }
}

function alternating(values: Array<number | null>): boolean {
  if (values.length < 4) return false;
  const [a, b, c, d] = values.slice(-4);
  return a !== b && a === c && b === d;
}

function hasPending(delta: GuardStatsDelta): boolean {
  return Object.keys(delta).length > 0;
}

function mergePending(target: GuardStatsDelta, source: GuardStatsDelta): GuardStatsDelta {
  const merged = { ...target };
  const incrementKeys: Array<keyof GuardStatsDelta> = [
    'sessionOpenAttemptCount',
    'sessionOpenSuccessCount',
    'failedOpen429Count',
    'historyRequestCount',
    'singleFlightHitCount',
    'olderPageSuppressedCount',
    'rateLimitCooldownStartCount',
    'rateLimitCooldownHitCount',
    'spaSwitchCount',
    'windowFlappingDetectedCount'
  ];
  for (const key of incrementKeys) {
    const value = source[key];
    if (typeof value === 'number') addDelta(merged, key, value);
  }
  merged.maxActiveConversationDomNodes = Math.max(
    merged.maxActiveConversationDomNodes ?? 0,
    source.maxActiveConversationDomNodes ?? 0
  );
  merged.maxDocumentDomNodes = Math.max(
    merged.maxDocumentDomNodes ?? 0,
    source.maxDocumentDomNodes ?? 0
  );
  const samples = [...(merged.switchLatencySamples ?? []), ...(source.switchLatencySamples ?? [])];
  if (samples.length > 0) merged.switchLatencySamples = samples;
  return merged;
}

export class LocalStatsBridge {
  private pending: GuardStatsDelta = {};
  private flushTimer: number | null = null;
  private lastSpaSwitchCount = 0;
  private lastLatencySwitchCount = -1;
  private maxActiveDom = 0;
  private maxDocumentDom = 0;
  private conversationId: string | null = null;
  private boundaryIndexes: Array<number | null> = [];
  private hiddenRounds: Array<number | null> = [];
  private flappingActive = false;

  recordEvent(event: GuardStatsEvent): void {
    const mapping: Partial<Record<GuardStatsEvent['type'], keyof GuardStatsDelta>> = {
      'session-open-attempt': 'sessionOpenAttemptCount',
      'session-open-success': 'sessionOpenSuccessCount',
      'failed-open-429': 'failedOpen429Count',
      'history-request': 'historyRequestCount',
      'single-flight-hit': 'singleFlightHitCount',
      'older-page-suppressed': 'olderPageSuppressedCount',
      'rate-limit-cooldown-start': 'rateLimitCooldownStartCount',
      'rate-limit-cooldown-hit': 'rateLimitCooldownHitCount'
    };
    const key = mapping[event.type];
    if (!key) return;
    addDelta(this.pending, key);
    this.scheduleFlush();
  }

  observeMetrics(metrics: DebugMetrics): void {
    let changed = false;
    if (metrics.spaSwitchCount > this.lastSpaSwitchCount) {
      addDelta(this.pending, 'spaSwitchCount', metrics.spaSwitchCount - this.lastSpaSwitchCount);
      this.lastSpaSwitchCount = metrics.spaSwitchCount;
      changed = true;
    }

    if (
      metrics.switchLatencyMs !== null &&
      metrics.spaSwitchCount > 0 &&
      metrics.spaSwitchCount !== this.lastLatencySwitchCount
    ) {
      this.pending.switchLatencySamples = [
        ...(this.pending.switchLatencySamples ?? []),
        metrics.switchLatencyMs
      ];
      this.lastLatencySwitchCount = metrics.spaSwitchCount;
      changed = true;
    }

    if (metrics.activeConversationDomNodes > this.maxActiveDom) {
      this.maxActiveDom = metrics.activeConversationDomNodes;
      this.pending.maxActiveConversationDomNodes = this.maxActiveDom;
      changed = true;
    }
    if (metrics.totalDocumentDomNodes > this.maxDocumentDom) {
      this.maxDocumentDom = metrics.totalDocumentDomNodes;
      this.pending.maxDocumentDomNodes = this.maxDocumentDom;
      changed = true;
    }

    if (changed) this.scheduleFlush();
  }

  observeEvaluation(conversationId: string | null, dom: DomWindowStats): void {
    if (conversationId !== this.conversationId) {
      this.conversationId = conversationId;
      this.boundaryIndexes = [];
      this.hiddenRounds = [];
      this.flappingActive = false;
    }
    if (!conversationId) return;

    this.boundaryIndexes.push(dom.boundaryIndex);
    this.hiddenRounds.push(dom.hiddenRounds);
    if (this.boundaryIndexes.length > 4) this.boundaryIndexes.shift();
    if (this.hiddenRounds.length > 4) this.hiddenRounds.shift();

    const flapping = alternating(this.boundaryIndexes) || alternating(this.hiddenRounds);
    if (flapping && !this.flappingActive) {
      addDelta(this.pending, 'windowFlappingDetectedCount');
      this.flappingActive = true;
      this.scheduleFlush();
    } else if (!flapping) {
      this.flappingActive = false;
    }
  }

  async flushNow(): Promise<void> {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!hasPending(this.pending)) return;
    const delta = this.pending;
    this.pending = {};
    try {
      await chrome.runtime.sendMessage({ type: 'csg:stats-apply-delta', delta });
    } catch {
      this.pending = mergePending(this.pending, delta);
    }
  }

  destroy(): void {
    void this.flushNow();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, FLUSH_DELAY_MS);
  }
}
