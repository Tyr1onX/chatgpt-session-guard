import type { GuardConfig } from '../shared/config';
import type { GuardStatsEvent } from '../shared/events';
import type { DebugMetrics } from '../shared/types';
import {
  FIELD_BURST_SAMPLE_MS,
  FIELD_BURST_WINDOW_MS,
  FIELD_IDLE_SAMPLE_MS,
  FIELD_POST_TRIGGER_MS,
  FIELD_PRE_TRIGGER_MS,
  FieldIncidentRepository,
  FieldRingBuffer,
  createFieldIncident,
  evaluateFieldSample,
  opaqueHash,
  type FieldIncidentCode,
  type FieldNetworkSummary,
  type FieldRecorderStatus,
  type FieldSample,
  type FieldSampleSource,
  type FieldStorageAdapter,
  type FieldTraceExcerpt
} from '../shared/field-recorder';
import { findConversationObserveRoot, findTurnElements, turnRole } from './dom-window';
import type { SessionTraceEvent } from './session-controller';

const PLACEHOLDER_ID = 'csg-history-placeholder';
const INCIDENT_COOLDOWN_MS = 10_000;

interface RecorderOptions {
  buildId: string;
  storage: FieldStorageAdapter;
  getConfig: () => GuardConfig;
  getMetrics: () => DebugMetrics;
  now?: () => number;
}

interface PendingIncident {
  triggerTimestamp: number;
  postUntil: number;
  incidentCodes: Set<FieldIncidentCode>;
  samples: FieldSample[];
}

interface ScrollerSnapshot {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

function visibleInLayout(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const opacity = Number.parseFloat(style.opacity || '1');
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && Number.isFinite(opacity)
    && opacity > 0.01
    && rect.width > 0
    && rect.height > 0;
}

function intersectsViewport(element: HTMLElement): boolean {
  if (!visibleInLayout(element)) return false;
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
}

function isScrollable(element: HTMLElement): boolean {
  const overflowY = getComputedStyle(element).overflowY;
  return element.scrollHeight > element.clientHeight + 1
    && (element === document.scrollingElement || /^(auto|scroll|overlay)$/.test(overflowY));
}

function conversationScroller(turns: HTMLElement[]): HTMLElement | null {
  const anchor = turns.find(intersectsViewport) ?? turns.find(visibleInLayout) ?? turns.at(-1) ?? null;
  let current = anchor?.parentElement ?? null;
  while (current && !isScrollable(current)) current = current.parentElement;
  const documentScroller = document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
  return current ?? (documentScroller && isScrollable(documentScroller) ? documentScroller : null);
}

function countVisibleRounds(turns: HTMLElement[]): number {
  let count = 0;
  let hasRound = false;
  for (const turn of turns) {
    const role = turnRole(turn);
    if (!hasRound || role === 'user') {
      count += 1;
      hasRound = true;
    }
  }
  return count;
}

function rawConversationId(): string | null {
  const match = /^\/c\/([^/?#]+)/.exec(location.pathname);
  return match?.[1] ?? null;
}

function turnOpaqueId(turn: HTMLElement | undefined): string | null {
  if (!turn) return null;
  return turn.getAttribute('data-turn-id')
    ?? turn.getAttribute('data-testid')
    ?? turn.querySelector<HTMLElement>('[data-message-id]')?.getAttribute('data-message-id')
    ?? null;
}

function safeSessionTrace(event: SessionTraceEvent): FieldTraceExcerpt {
  return {
    timestamp: event.timestamp,
    type: event.type,
    ...(event.reason ? { reason: event.reason } : {}),
    ...(typeof event.evaluateDurationMs === 'number' ? { evaluateDurationMs: event.evaluateDurationMs } : {}),
    ...(typeof event.observerMutationCount === 'number' ? { observerMutationCount: event.observerMutationCount } : {}),
    ...(typeof event.ignoredExtensionMutationCount === 'number' ? { ignoredExtensionMutationCount: event.ignoredExtensionMutationCount } : {}),
    cleanupCount: event.cleanupCount,
    visualRestoreCount: event.visualRestoreCount,
    ...(typeof event.scrollHeight === 'number' ? { scrollHeight: event.scrollHeight } : {})
  };
}

export class PassiveFieldRecorder {
  private readonly ring = new FieldRingBuffer<FieldSample>();
  private readonly traceRing = new FieldRingBuffer<FieldTraceExcerpt>(80);
  private readonly repository: FieldIncidentRepository;
  private readonly now: () => number;
  private readonly networkSummary: FieldNetworkSummary = {
    historyRequestCount: 0,
    olderPageNetworkCount: 0,
    olderPageSuppressedCount: 0,
    rateLimitedHistoryRequestCount: 0,
    singleFlightHitCount: 0,
    unclassifiedHistoryLikeCount: 0
  };
  private idleTimer: number | null = null;
  private burstTimer: number | null = null;
  private burstUntil = 0;
  private burstSource: FieldSampleSource = 'idle';
  private mutationObserver: MutationObserver | null = null;
  private abort: AbortController | null = null;
  private mutationMarker = 0;
  private evaluateMarker = 0;
  private incidentSequence = 0;
  private lastGuardBoundaryIndex: number | null = null;
  private lastGuardBoundaryHash: string | null = null;
  private incidentCooldownUntil = 0;
  private pending: PendingIncident | null = null;
  private writingIncident = false;
  private listening = false;

  constructor(private readonly options: RecorderOptions) {
    this.repository = new FieldIncidentRepository(options.storage);
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    if (this.listening) return;
    this.listening = true;
    this.abort = new AbortController();
    const signal = this.abort.signal;

    window.addEventListener('scroll', () => this.markActivity('scroll'), { passive: true, capture: true, signal });
    window.addEventListener('wheel', () => this.markActivity('wheel'), { passive: true, capture: true, signal });
    window.addEventListener('csg:navigation', () => {
      this.observeConversationRoot();
      this.markActivity('navigation');
    }, { signal });

    this.mutationObserver = new MutationObserver(() => {
      this.mutationMarker += 1;
      this.markActivity('mutation');
    });
    this.observeConversationRoot();

    this.idleTimer = window.setInterval(() => this.capture('idle'), FIELD_IDLE_SAMPLE_MS);
    this.capture('idle');
  }

  destroy(): void {
    this.listening = false;
    this.abort?.abort();
    this.abort = null;
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    if (this.idleTimer !== null) window.clearInterval(this.idleTimer);
    if (this.burstTimer !== null) window.clearInterval(this.burstTimer);
    this.idleTimer = null;
    this.burstTimer = null;
    if (this.pending) void this.finalizePending();
  }

  notifyEvaluation(): void {
    this.evaluateMarker += 1;
    this.markActivity('evaluate');
  }

  recordSessionTrace(event: SessionTraceEvent): void {
    this.traceRing.push(safeSessionTrace(event));
    if (event.type === 'evaluate' && event.dom) {
      this.lastGuardBoundaryIndex = event.dom.boundaryIndex;
      this.lastGuardBoundaryHash = opaqueHash(event.dom.boundaryTurnId, this.options.buildId);
    }
  }

  recordStatsEvent(type: GuardStatsEvent['type']): void {
    if (type === 'history-request') this.networkSummary.historyRequestCount += 1;
    if (type === 'failed-open-429') this.networkSummary.rateLimitedHistoryRequestCount += 1;
    if (type === 'single-flight-hit') this.networkSummary.singleFlightHitCount += 1;
    if (type === 'older-page-suppressed') this.networkSummary.olderPageSuppressedCount += 1;
  }

  async status(): Promise<FieldRecorderStatus> {
    const store = await this.repository.load();
    const recent = store.incidents.at(-1);
    return {
      enabled: true,
      listening: this.listening,
      buildId: this.options.buildId,
      incidentCount: store.incidents.length,
      recentCode: recent?.incidentCodes[0] ?? null
    };
  }

  async reset(): Promise<void> {
    await this.repository.reset();
  }

  private observeConversationRoot(): void {
    if (!this.mutationObserver) return;
    this.mutationObserver.disconnect();
    this.mutationObserver.observe(findConversationObserveRoot(), {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden']
    });
  }

  private markActivity(source: FieldSampleSource): void {
    this.capture(source);
    this.burstSource = source;
    this.burstUntil = Math.max(this.burstUntil, this.now() + FIELD_BURST_WINDOW_MS);
    if (this.burstTimer !== null) return;
    this.burstTimer = window.setInterval(() => {
      if (this.now() > this.burstUntil) {
        if (this.burstTimer !== null) window.clearInterval(this.burstTimer);
        this.burstTimer = null;
        return;
      }
      this.capture(this.burstSource);
    }, FIELD_BURST_SAMPLE_MS);
  }

  private capture(source: FieldSampleSource): void {
    if (!this.listening) return;
    const sample = this.readSample(source);
    this.ring.push(sample);
    const codes = evaluateFieldSample(sample);

    if (codes.length > 0 && sample.timestamp >= this.incidentCooldownUntil) {
      if (!this.pending) {
        this.pending = {
          triggerTimestamp: sample.timestamp,
          postUntil: sample.timestamp + FIELD_POST_TRIGGER_MS,
          incidentCodes: new Set(codes),
          samples: this.ring.since(sample.timestamp - FIELD_PRE_TRIGGER_MS)
        };
      } else {
        for (const code of codes) this.pending.incidentCodes.add(code);
      }
    }

    if (this.pending) {
      const last = this.pending.samples.at(-1);
      if (!last || last.timestamp < sample.timestamp) this.pending.samples.push(sample);
      if (sample.timestamp >= this.pending.postUntil) void this.finalizePending();
    }
  }

  private readSample(source: FieldSampleSource): FieldSample {
    const timestamp = this.now();
    const config = this.options.getConfig();
    const metrics = this.options.getMetrics();
    const turns = findTurnElements();
    const layoutVisibleTurns = turns.filter(visibleInLayout);
    const placeholder = document.getElementById(PLACEHOLDER_ID) as HTMLElement | null;
    const oldTurns = placeholder
      ? turns.filter((turn) => Boolean(turn.compareDocumentPosition(placeholder) & Node.DOCUMENT_POSITION_FOLLOWING))
      : [];
    const scroller = conversationScroller(turns);
    const boundaryIndex = turns.findIndex((turn) => visibleInLayout(turn));
    const boundaryTurn = boundaryIndex >= 0 ? turns[boundaryIndex] : undefined;
    const conversationHash = opaqueHash(rawConversationId(), this.options.buildId);
    const boundaryTurnHash = opaqueHash(turnOpaqueId(boundaryTurn), this.options.buildId);
    const scrollerSnapshot: ScrollerSnapshot = {
      scrollTop: scroller?.scrollTop ?? 0,
      scrollHeight: scroller?.scrollHeight ?? 0,
      clientHeight: scroller?.clientHeight ?? 0
    };

    return {
      timestamp,
      source,
      conversationHash,
      ...scrollerSnapshot,
      placeholderPresent: Boolean(placeholder),
      placeholderVisible: Boolean(placeholder && visibleInLayout(placeholder)),
      placeholderIntersectsViewport: Boolean(placeholder && intersectsViewport(placeholder)),
      configuredRounds: config.historyUnit === 'round' ? config.historyCount : metrics.renderedRounds,
      visibleTurns: layoutVisibleTurns.length,
      visibleRounds: countVisibleRounds(layoutVisibleTurns),
      oldTurnsVisibleInLayout: oldTurns.some(visibleInLayout),
      oldTurnsIntersectViewport: oldTurns.some(intersectsViewport),
      boundaryIndex: this.lastGuardBoundaryIndex ?? (boundaryIndex >= 0 ? boundaryIndex : null),
      boundaryTurnHash: this.lastGuardBoundaryHash ?? boundaryTurnHash,
      metricsRenderedRounds: metrics.renderedRounds,
      metricsHiddenRounds: Math.max(0, metrics.totalRounds - metrics.renderedRounds),
      temporaryFullHistory: config.temporaryFullHistory,
      historyExpansion: config.historyExpansion,
      guardEnabled: config.enabled,
      guardMode: config.mode,
      mutationMarker: this.mutationMarker,
      evaluateMarker: this.evaluateMarker
    };
  }

  private async finalizePending(): Promise<void> {
    if (!this.pending || this.writingIncident) return;
    this.writingIncident = true;
    const pending = this.pending;
    this.pending = null;
    try {
      const incident = createFieldIncident({
        id: `field-${pending.triggerTimestamp}-${this.incidentSequence += 1}`,
        buildId: this.options.buildId,
        triggerTimestamp: pending.triggerTimestamp,
        incidentCodes: [...pending.incidentCodes],
        samples: pending.samples,
        traceExcerpt: this.traceRing.since(pending.triggerTimestamp - FIELD_PRE_TRIGGER_MS),
        networkSummary: this.networkSummary
      });
      await this.repository.add(incident);
      this.incidentCooldownUntil = this.now() + INCIDENT_COOLDOWN_MS;
    } finally {
      this.writingIncident = false;
    }
  }
}
