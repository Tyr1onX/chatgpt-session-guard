import { describe, expect, it } from 'vitest';
import {
  analyzeMode,
  benchmarkReport,
  benchmarkTargets,
  emptyModeResult,
  preliminaryConclusion,
  type BenchmarkMode,
  type BenchmarkModeResult,
  type BenchmarkSample,
  type BenchmarkState
} from '../src/shared/benchmark';
import { DEFAULT_CONFIG } from '../src/shared/config';

function sample(
  switchCount: number,
  dom: number,
  heap: number | null,
  mode: BenchmarkSample['mode'] = 'control'
): BenchmarkSample {
  return {
    timestamp: switchCount,
    mode,
    switchCount,
    conversationId: 'conversation-a',
    renderedRounds: mode === 'ultra-lite' ? 1 : 8,
    renderedMessages: mode === 'ultra-lite' ? 2 : 16,
    configuredHistoryCount: mode === 'ultra-lite' ? 1 : 8,
    historyUnit: 'round',
    limitedByDomBudget: false,
    conversationDomNodes: dom,
    activeConversationDomNodes: Math.min(dom, mode === 'ultra-lite' ? 500 : 2000),
    documentDomNodes: dom + 1000,
    cleanupCount: switchCount,
    hardSwitchCount: 0,
    networkMode: mode === 'control' ? 'disabled' : 'paginated',
    networkRequestedTurns: mode === 'control' ? null : 10,
    networkEffectiveTurns: mode === 'control' ? null : mode === 'ultra-lite' ? 4 : 8,
    jsHeapMb: heap,
    switchLatencyMs: switchCount === 0 ? null : 200,
    longTaskCount: 0,
    longTaskBlockingMs: 0,
    route: '/c/conversation-a'
  };
}

function result(mode: BenchmarkMode, samples: BenchmarkSample[]): BenchmarkModeResult {
  const value = emptyModeResult(mode);
  value.samples = samples;
  value.switchLatenciesMs = [180, 190, 200, 210, 220];
  value.completedSwitches = 50;
  value.analysis = analyzeMode(value);
  return value;
}

function allResults(overrides: Partial<Record<BenchmarkMode, BenchmarkModeResult>> = {}): Record<BenchmarkMode, BenchmarkModeResult> {
  return {
    control: overrides.control ?? emptyModeResult('control'),
    balanced: overrides.balanced ?? emptyModeResult('balanced'),
    'ultra-lite': overrides['ultra-lite'] ?? emptyModeResult('ultra-lite'),
    aggressive: overrides.aggressive ?? emptyModeResult('aggressive')
  };
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

  it('detects stable DOM with strongly growing heap as retained SPA state', () => {
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

  it('does not claim improvement when Standard control is stable', () => {
    const steps = [0, 10, 20, 30, 40, 50];
    const control = result('control', steps.map((step) => sample(step, 5000 + step, 500 + step / 10)));
    const balanced = result('balanced', steps.map((step) => sample(step, 3000 + step, 500 + step / 10, 'balanced')));
    const ultra = result('ultra-lite', steps.map((step) => sample(step, 800 + step, 500 + step / 10, 'ultra-lite')));
    expect(preliminaryConclusion(allResults({ control, balanced, 'ultra-lite': ultra })).conclusion).toBe('inconclusive');
  });

  it('reports proven improvement when Control grows and Balanced/Ultra Lite stay stable', () => {
    const steps = [0, 10, 20, 30, 40, 50];
    const control = result('control', steps.map((step, index) => sample(step, 5000 + index * 700, 400 + index * 180)));
    const balanced = result('balanced', steps.map((step, index) => sample(step, 3000 + index * 5, 420 + index * 3, 'balanced')));
    const ultra = result('ultra-lite', steps.map((step, index) => sample(step, 700 + index * 2, 410 + index * 2, 'ultra-lite')));
    const conclusion = preliminaryConclusion(allResults({ control, balanced, 'ultra-lite': ultra }));
    expect(conclusion.conclusion).toBe('proven improvement');
  });

  it('does not claim retained-memory proof when heap is unavailable', () => {
    const steps = [0, 10, 20, 30, 40, 50];
    const control = result('control', steps.map((step, index) => sample(step, 5000 + index * 800, null)));
    const balanced = result('balanced', steps.map((step, index) => sample(step, 2600 + index * 10, null, 'balanced')));
    const ultra = result('ultra-lite', steps.map((step, index) => sample(step, 700 + index * 2, null, 'ultra-lite')));
    const conclusion = preliminaryConclusion(allResults({ control, balanced, 'ultra-lite': ultra }));
    expect(conclusion.conclusion).not.toBe('proven improvement');
  });

  it('renders only modes selected by the benchmark profile', () => {
    const steps = [0, 10, 20, 30, 40, 50];
    const control = result('control', steps.map((step) => sample(step, 5000, 500)));
    const balanced = result('balanced', steps.map((step) => sample(step, 3000, 500, 'balanced')));
    const ultra = result('ultra-lite', steps.map((step) => sample(step, 800, 500, 'ultra-lite')));
    const state: BenchmarkState = {
      version: 1,
      sessionId: 'test',
      profile: 'standard',
      status: 'complete',
      phase: 'primary',
      pauseReason: null,
      startedAt: 1,
      completedAt: 2,
      loops: 5,
      switchesPerMode: 50,
      conversationIds: ['A', 'B', 'C', 'D', 'E'],
      modeOrder: ['control', 'balanced', 'ultra-lite'],
      modeIndex: 3,
      currentSwitch: 50,
      expectedConversationId: null,
      retryCount: 0,
      originalConfig: DEFAULT_CONFIG,
      environment: { userAgent: 'Chrome', buildId: 'abc', startedAt: 1, conversationCount: 5, switchesPerMode: 50, loops: 5, rendererMemory: 'not-collected' },
      results: allResults({ control, balanced, 'ultra-lite': ultra }),
      sessionGc: null,
      sessionGcPendingStartedAt: null,
      sessionGcPendingTarget: null,
      conclusion: 'inconclusive',
      conclusionReason: 'test'
    };
    const report = benchmarkReport(state);
    expect(report).toContain('## Ultra-lite');
    expect(report).not.toContain('## Aggressive');
    expect(report).toContain('Benchmark profile: standard');
  });
});
