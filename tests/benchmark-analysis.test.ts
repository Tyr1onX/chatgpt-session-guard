import { describe, expect, it } from 'vitest';
import {
  analyzeMode,
  benchmarkReport,
  benchmarkTargets,
  emptySessionGcResult,
  emptyModeResult,
  preliminaryConclusion,
  type BenchmarkModeResult,
  type BenchmarkSample,
  type BenchmarkState
} from '../src/shared/benchmark';

function sample(switchCount: number, dom: number, heap: number | null, mode: BenchmarkSample['mode'] = 'control'): BenchmarkSample {
  return {
    timestamp: switchCount,
    mode,
    switchCount,
    conversationId: 'conversation-a',
    renderedRounds: 8,
    conversationDomNodes: dom,
    documentDomNodes: dom + 1000,
    cleanupCount: switchCount,
    hardSwitchCount: 0,
    networkMode: mode === 'control' ? 'disabled' : 'paginated',
    networkRequestedTurns: mode === 'control' ? null : 50,
    networkEffectiveTurns: mode === 'control' ? null : 8,
    jsHeapMb: heap,
    switchLatencyMs: switchCount === 0 ? null : 200,
    longTaskCount: 0,
    longTaskBlockingMs: 0,
    route: '/c/conversation-a'
  };
}

function result(mode: BenchmarkModeResult['mode'], samples: BenchmarkSample[]): BenchmarkModeResult {
  const value = emptyModeResult(mode);
  value.samples = samples;
  value.switchLatenciesMs = [180, 190, 200, 210, 220];
  value.completedSwitches = 50;
  value.analysis = analyzeMode(value);
  return value;
}

describe('automatic benchmark analysis', () => {
  it('builds exactly 50 or 100 real-change targets from five conversations', () => {
    const ids = ['A', 'B', 'C', 'D', 'E'];
    const fifty = benchmarkTargets(ids, 5);
    const hundred = benchmarkTargets(ids, 10);
    expect(fifty).toHaveLength(50);
    expect(hundred).toHaveLength(100);
    expect(fifty.slice(0, 10)).toEqual(['A', 'B', 'C', 'D', 'E', 'A', 'C', 'B', 'D', 'E']);
    expect(fifty.every((target, index) => index === 0 || target !== fifty[index - 1])).toBe(true);
  });

  it('detects stable DOM with strongly growing heap as likely retained SPA state', () => {
    const value = result('aggressive', [
      sample(0, 600, 400, 'aggressive'),
      sample(10, 605, 500, 'aggressive'),
      sample(20, 602, 620, 'aggressive'),
      sample(30, 608, 760, 'aggressive'),
      sample(40, 604, 920, 'aggressive'),
      sample(50, 606, 1100, 'aggressive')
    ]);
    expect(value.analysis?.conversationDom.level).toBe('stable');
    expect(value.analysis?.heap.level).toBe('strong growth');
    expect(value.analysis?.spaRetainedStateLikely).toBe(true);
  });

  it('does not claim improvement when control is stable', () => {
    const stable = [0, 10, 20, 30, 40, 50].map((step) => sample(step, 5000 + step, 500 + step / 10));
    const control = result('control', stable);
    const balanced = result('balanced', stable.map((item) => ({ ...item, mode: 'balanced' })));
    const aggressive = result('aggressive', stable.map((item) => ({ ...item, mode: 'aggressive' })));
    const conclusion = preliminaryConclusion({ control, balanced, aggressive });
    expect(conclusion.conclusion).toBe('inconclusive');
  });

  it('includes an optional Session GC section without changing an inconclusive primary result by itself', () => {
    const steps = [0, 10, 20, 30, 40, 50];
    const control = result('control', steps.map((step) => sample(step, 5000, 500)));
    const balanced = result('balanced', steps.map((step) => sample(step, 3000, 500, 'balanced')));
    const aggressive = result('aggressive', steps.map((step) => sample(step, 650, 500, 'aggressive')));
    const sessionGc = emptySessionGcResult();
    sessionGc.samples = steps.map((step) => sample(step, 650, 480, 'session-gc'));
    sessionGc.analysis = analyzeMode(sessionGc);
    sessionGc.hardReloadCount = 1;
    const state: BenchmarkState = {
      version: 1 as const,
      sessionId: 'test',
      status: 'complete' as const,
      phase: 'session-gc' as const,
      pauseReason: null,
      startedAt: 1,
      completedAt: 2,
      loops: 5 as const,
      switchesPerMode: 50,
      conversationIds: ['A', 'B', 'C', 'D', 'E'],
      modeOrder: ['control', 'balanced', 'aggressive'],
      modeIndex: 3,
      currentSwitch: 50,
      expectedConversationId: null,
      retryCount: 0,
      originalConfig: { version: 1 as const, enabled: true, mode: 'balanced' as const, recentRounds: 8, minRounds: 4, targetRounds: 8, maxRounds: 12, domBudget: 7000, temporaryFullHistory: false, hardSwitchEnabled: false, debug: false },
      environment: { userAgent: 'Chrome', buildId: 'abc', startedAt: 1, conversationCount: 5, switchesPerMode: 50, loops: 5, rendererMemory: 'not-collected' as const },
      results: { control, balanced, aggressive },
      sessionGc,
      sessionGcPendingStartedAt: null,
      sessionGcPendingTarget: null,
      conclusion: 'inconclusive' as const,
      conclusionReason: 'Control did not reproduce growth.'
    };
    const report = benchmarkReport(state);
    expect(report).toContain('## Session-gc');
    expect(report).toContain('Controlled hard reloads: 1');
    expect(report).toContain('**inconclusive**');
  });

  it('reports proven improvement only when control growth is reproduced and aggressive stabilizes', () => {
    const steps = [0, 10, 20, 30, 40, 50];
    const control = result('control', steps.map((step, index) => sample(step, 5000 + index * 700, 400 + index * 180)));
    const balanced = result('balanced', steps.map((step, index) => sample(step, 3000 + index * 250, 400 + index * 80, 'balanced')));
    const aggressive = result('aggressive', steps.map((step, index) => sample(step, 650 + index * 3, 420 + index * 5, 'aggressive')));
    const conclusion = preliminaryConclusion({ control, balanced, aggressive });
    expect(conclusion.conclusion).toBe('proven improvement');
  });
  it('classifies stable DOM plus strong Aggressive heap growth as partial improvement with Session GC needed', () => {
    const steps = [0, 10, 20, 30, 40, 50];
    const control = result('control', steps.map((step, index) => sample(step, 5000 + index * 650, 400 + index * 180)));
    const balanced = result('balanced', steps.map((step, index) => sample(step, 2500 + index * 100, 420 + index * 130, 'balanced')));
    const aggressive = result('aggressive', steps.map((step, index) => sample(step, 650 + index * 2, 430 + index * 170, 'aggressive')));
    const conclusion = preliminaryConclusion({ control, balanced, aggressive });
    expect(aggressive.analysis?.spaRetainedStateLikely).toBe(true);
    expect(conclusion.conclusion).toBe('partial improvement');
    expect(conclusion.reason).toContain('Session GC');
  });

  it('does not claim proven retained-memory improvement when JS heap is unavailable', () => {
    const steps = [0, 10, 20, 30, 40, 50];
    const control = result('control', steps.map((step, index) => sample(step, 5000 + index * 800, null)));
    const balanced = result('balanced', steps.map((step, index) => sample(step, 2200 + index * 180, null, 'balanced')));
    const aggressive = result('aggressive', steps.map((step, index) => sample(step, 650 + index * 2, null, 'aggressive')));
    const conclusion = preliminaryConclusion({ control, balanced, aggressive });
    expect(conclusion.conclusion).toBe('partial improvement');
    expect(conclusion.reason).toContain('JS heap was unavailable');
  });

});
