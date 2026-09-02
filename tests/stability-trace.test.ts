import { describe, expect, it, vi } from 'vitest';
import { StabilityTraceCollector, stabilityTraceReport } from '../src/content/stability-trace';
import type { SessionTraceEvent } from '../src/content/session-controller';
import type { NetworkTraceEvent } from '../src/main-world/fetch-guard';

function evaluate(timestamp: number, boundaryIndex: number, hiddenRounds: number, scrollHeight: number, duration = 10): SessionTraceEvent {
  return {
    timestamp,
    conversationId: 'abc',
    navigationEpoch: 1,
    type: 'evaluate',
    reason: 'conversation-topology',
    evaluateDurationMs: duration,
    cleanupCount: 0,
    visualRestoreCount: 0,
    pathname: '/c/abc',
    queryKeys: [],
    scrollHeight,
    dom: {
      totalRounds: 20,
      renderedRounds: 1,
      totalMessages: 40,
      renderedMessages: 2,
      conversationDomNodes: 1000,
      activeConversationDomNodes: 70,
      hiddenRounds,
      prunedTurns: 0,
      configuredHistoryCount: 1,
      historyUnit: 'round',
      limitedByDomBudget: false,
      boundaryIndex,
      boundaryTurnId: `turn-${boundaryIndex}`,
      lastVisibleUserIndex: boundaryIndex,
      generationActive: false
    }
  };
}

describe('stability trace', () => {
  it('detects alternating boundary/scroll-height window flapping', () => {
    vi.spyOn(Date, 'now').mockReturnValue(5000);
    const trace = new StabilityTraceCollector();
    trace.addSession(evaluate(2000, 5, 15, 6000));
    trace.addSession(evaluate(2500, 12, 8, 3000));
    trace.addSession(evaluate(3000, 5, 15, 6000));
    trace.addSession(evaluate(3500, 12, 8, 3000));
    const snapshot = trace.snapshot();
    expect(snapshot.flappingDetected).toBe(true);
    expect(snapshot.alerts).toContain('WINDOW_FLAPPING_DETECTED');
    expect(snapshot.flappingReasons).toContain('boundary-alternation');
    expect(snapshot.flappingReasons).toContain('hidden-round-alternation');
    expect(snapshot.flappingReasons).toContain('scroll-height-alternation');
    vi.restoreAllMocks();
  });

  it('summarizes evaluate p95/max and heavy parse without conversation text', () => {
    const trace = new StabilityTraceCollector();
    trace.addSession(evaluate(Date.now(), 10, 19, 3000, 12));
    trace.addSession(evaluate(Date.now(), 10, 19, 3000, 60));
    trace.addSession(evaluate(Date.now(), 10, 19, 3000, 120));
    const network: NetworkTraceEvent = {
      timestamp: Date.now(),
      type: 'history-request',
      kind: 'paginated-conversation-history',
      conversationId: 'abc',
      pathname: '/backend-api/conversations/abc',
      queryKeys: ['num_turns'],
      historyParseMs: 280,
      heavyHistoryParse: 'over-250ms',
      preflightSuppressed: false
    };
    trace.addNetwork(network);
    const snapshot = trace.snapshot();
    expect(snapshot.summary.evaluateMaxMs).toBe(120);
    expect(snapshot.summary.verySlowEvaluateCount).toBe(2);
    expect(snapshot.summary.criticalEvaluateCount).toBe(1);
    expect(snapshot.summary.heavyHistoryParseCount).toBe(1);
    expect(snapshot.summary.historyParseTotalMs).toBe(280);
    expect(JSON.stringify(snapshot)).not.toContain('prompt');
    expect(stabilityTraceReport(snapshot)).toContain('History parse total: 280 ms');
  });

  it('distinguishes zero-fetch older-page suppression from older pages that reached network', () => {
    const trace = new StabilityTraceCollector();
    const base: Omit<NetworkTraceEvent, 'preflightSuppressed'> = {
      timestamp: Date.now(),
      type: 'history-request',
      kind: 'paginated-conversation-page',
      conversationId: 'abc',
      pathname: '/backend-api/conversations/abc/messages',
      queryKeys: ['before']
    };
    trace.addNetwork({ ...base, preflightSuppressed: true });
    trace.addNetwork({ ...base, preflightSuppressed: false, historyParseMs: 25 });
    const summary = trace.snapshot().summary;
    expect(summary.preflightSuppressedOlderPageCount).toBe(1);
    expect(summary.olderPageNetworkCount).toBe(1);
  });

  it('summarizes single-flight and 429 cooldown protection events', () => {
    const trace = new StabilityTraceCollector();
    const protectionBase = {
      timestamp: Date.now(),
      type: 'history-protection',
      kind: 'paginated-conversation-history',
      conversationId: 'abc',
      pathname: '/backend-api/conversations/abc',
      queryKeys: ['num_turns']
    };
    trace.addNetwork({ ...protectionBase, protection: 'single-flight-hit' } as unknown as NetworkTraceEvent);
    trace.addNetwork({ ...protectionBase, protection: 'single-flight-hit' } as unknown as NetworkTraceEvent);
    trace.addNetwork({ ...protectionBase, protection: 'rate-limit-cooldown-start', cooldownMs: 2000 } as unknown as NetworkTraceEvent);
    trace.addNetwork({ ...protectionBase, protection: 'rate-limit-cooldown-hit', cooldownMs: 1500 } as unknown as NetworkTraceEvent);

    const snapshot = trace.snapshot();
    expect(snapshot.summary.singleFlightHitCount).toBe(2);
    expect(snapshot.summary.rateLimitCooldownStartCount).toBe(1);
    expect(snapshot.summary.rateLimitCooldownHitCount).toBe(1);
    expect(snapshot.summary.rateLimitCooldownMaxMs).toBe(2000);
    const report = stabilityTraceReport(snapshot);
    expect(report).toContain('Concurrent history requests coalesced: 2');
    expect(report).toContain('Retries blocked by 429 cooldown: 1');
  });
});
