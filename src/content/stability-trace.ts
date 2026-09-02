import type { NetworkTraceEvent } from '../main-world/fetch-guard';
import type { SessionTraceEvent } from './session-controller';

export interface StabilityTraceSummary {
  evaluateCount: number;
  evaluateAvgMs: number;
  evaluateP95Ms: number;
  evaluateMaxMs: number;
  slowEvaluateCount: number;
  verySlowEvaluateCount: number;
  criticalEvaluateCount: number;
  cleanupCount: number;
  visualRestoreCount: number;
  boundaryChangeCount: number;
  observerMutationCount: number;
  ignoredExtensionMutationCount: number;
  historyRequestCount: number;
  olderPageNetworkCount: number;
  preflightSuppressedOlderPageCount: number;
  heavyHistoryParseCount: number;
  historyParseTotalMs: number;
  unclassifiedHistoryLikeCount: number;
}

export interface StabilityTraceSnapshot {
  version: 1;
  startedAt: number;
  exportedAt: number;
  flappingDetected: boolean;
  alerts: string[];
  flappingReasons: string[];
  summary: StabilityTraceSummary;
  sessionEvents: SessionTraceEvent[];
  networkEvents: NetworkTraceEvent[];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

function alternating(values: Array<number | string | null>): boolean {
  if (values.length < 4) return false;
  const [a, b, c, d] = values.slice(-4);
  return a !== b && a === c && b === d;
}

function largeScrollAlternation(values: number[]): boolean {
  if (values.length < 4 || !alternating(values)) return false;
  const [a, b] = values.slice(-4);
  if (a === undefined || b === undefined) return false;
  return Math.abs(a - b) >= Math.max(300, Math.min(a, b) * 0.15);
}

function isOlderPage(event: NetworkTraceEvent): boolean {
  return event.kind === 'paginated-conversation-page';
}

export class StabilityTraceCollector {
  private readonly startedAt = Date.now();
  private readonly sessionEvents: SessionTraceEvent[] = [];
  private readonly networkEvents: NetworkTraceEvent[] = [];
  private readonly flappingReasons = new Set<string>();
  private boundaryChangeCount = 0;
  private lastBoundaryTurnId: string | null | undefined;

  addSession(event: SessionTraceEvent): void {
    if (event.type === 'evaluate' && event.dom) {
      if (this.lastBoundaryTurnId !== undefined && this.lastBoundaryTurnId !== event.dom.boundaryTurnId) {
        this.boundaryChangeCount += 1;
      }
      this.lastBoundaryTurnId = event.dom.boundaryTurnId;
    }
    this.sessionEvents.push(event);
    if (this.sessionEvents.length > 1500) this.sessionEvents.splice(0, this.sessionEvents.length - 1500);
    this.detectFlapping();
  }

  addNetwork(event: NetworkTraceEvent): void {
    this.networkEvents.push(event);
    if (this.networkEvents.length > 1000) this.networkEvents.splice(0, this.networkEvents.length - 1000);
  }

  snapshot(): StabilityTraceSnapshot {
    const evaluateEvents = this.sessionEvents.filter((event) => event.type === 'evaluate' && typeof event.evaluateDurationMs === 'number');
    const durations = evaluateEvents.map((event) => event.evaluateDurationMs ?? 0);
    const lastSession = this.sessionEvents.at(-1);
    const historyRequests = this.networkEvents.filter((event) => event.type === 'history-request');
    const actualOlderNetwork = historyRequests.filter((event) => isOlderPage(event) && event.preflightSuppressed !== true);
    const preflight = historyRequests.filter((event) => isOlderPage(event) && event.preflightSuppressed === true);
    const parseValues = historyRequests.map((event) => event.historyParseMs ?? 0);
    return {
      version: 1,
      startedAt: this.startedAt,
      exportedAt: Date.now(),
      flappingDetected: this.flappingReasons.size > 0,
      alerts: this.flappingReasons.size > 0 ? ['WINDOW_FLAPPING_DETECTED'] : [],
      flappingReasons: [...this.flappingReasons],
      summary: {
        evaluateCount: durations.length,
        evaluateAvgMs: round(durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0),
        evaluateP95Ms: round(percentile(durations, 0.95)),
        evaluateMaxMs: round(Math.max(0, ...durations)),
        slowEvaluateCount: durations.filter((value) => value > 16).length,
        verySlowEvaluateCount: durations.filter((value) => value > 50).length,
        criticalEvaluateCount: durations.filter((value) => value > 100).length,
        cleanupCount: lastSession?.cleanupCount ?? 0,
        visualRestoreCount: lastSession?.visualRestoreCount ?? 0,
        boundaryChangeCount: this.boundaryChangeCount,
        observerMutationCount: this.sessionEvents.reduce((sum, event) => sum + (event.observerMutationCount ?? 0), 0),
        ignoredExtensionMutationCount: this.sessionEvents.reduce((sum, event) => sum + (event.ignoredExtensionMutationCount ?? 0), 0),
        historyRequestCount: historyRequests.length,
        olderPageNetworkCount: actualOlderNetwork.length,
        preflightSuppressedOlderPageCount: preflight.length,
        heavyHistoryParseCount: historyRequests.filter((event) => event.heavyHistoryParse !== undefined).length,
        historyParseTotalMs: round(parseValues.reduce((sum, value) => sum + value, 0)),
        unclassifiedHistoryLikeCount: this.networkEvents.filter((event) => event.type === 'unclassified-history-like').length
      },
      sessionEvents: [...this.sessionEvents],
      networkEvents: [...this.networkEvents]
    };
  }

  private detectFlapping(): void {
    const cutoff = Date.now() - 5000;
    const recent = this.sessionEvents.filter((event) => event.type === 'evaluate' && event.timestamp >= cutoff && event.dom);
    if (recent.length < 4) return;
    const conversation = recent.at(-1)?.conversationId;
    const sameConversation = recent.filter((event) => event.conversationId === conversation).slice(-6);
    if (sameConversation.length < 4) return;

    const boundaries = sameConversation.map((event) => event.dom?.boundaryIndex ?? null);
    const hiddenRounds = sameConversation.map((event) => event.dom?.hiddenRounds ?? -1);
    const scrollHeights = sameConversation.map((event) => event.scrollHeight ?? 0);
    if (alternating(boundaries)) this.flappingReasons.add('boundary-alternation');
    if (alternating(hiddenRounds)) this.flappingReasons.add('hidden-round-alternation');
    if (largeScrollAlternation(scrollHeights)) this.flappingReasons.add('scroll-height-alternation');
  }
}

export function stabilityTraceReport(snapshot: StabilityTraceSnapshot): string {
  const s = snapshot.summary;
  const lines = [
    '# ChatGPT Session Guard Stability Trace',
    '',
    `- Started: ${new Date(snapshot.startedAt).toISOString()}`,
    `- Exported: ${new Date(snapshot.exportedAt).toISOString()}`,
    `- Window flapping: ${snapshot.flappingDetected ? `DETECTED (${snapshot.flappingReasons.join(', ')})` : 'not detected'}`,
    '',
    '## Evaluate',
    '',
    `- Count: ${s.evaluateCount}`,
    `- Average: ${s.evaluateAvgMs} ms`,
    `- p95: ${s.evaluateP95Ms} ms`,
    `- Max: ${s.evaluateMaxMs} ms`,
    `- >16 ms / >50 ms / >100 ms: ${s.slowEvaluateCount} / ${s.verySlowEvaluateCount} / ${s.criticalEvaluateCount}`,
    '',
    '## Lifecycle',
    '',
    `- Cleanup count: ${s.cleanupCount}`,
    `- Visual restore count: ${s.visualRestoreCount}`,
    `- Boundary changes: ${s.boundaryChangeCount}`,
    `- Observer mutations: ${s.observerMutationCount}`,
    `- Ignored extension mutations: ${s.ignoredExtensionMutationCount}`,
    '',
    '## Network',
    '',
    `- History requests traced: ${s.historyRequestCount}`,
    `- Older-page requests that reached network/parse: ${s.olderPageNetworkCount}`,
    `- Older pages preflight-suppressed: ${s.preflightSuppressedOlderPageCount}`,
    `- History parse total: ${s.historyParseTotalMs} ms`,
    `- Heavy history parses: ${s.heavyHistoryParseCount}`,
    `- Unclassified history-like GET paths: ${s.unclassifiedHistoryLikeCount}`,
    '',
    '> Trace contains IDs, paths, query-key names, counts and timings only. It does not contain conversation text, prompts, answers, file contents or image contents.'
  ];
  return lines.join('\n');
}
