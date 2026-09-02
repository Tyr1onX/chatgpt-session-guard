import type { GuardConfig } from './config';
import type { NetworkMode } from './events';

export type BenchmarkMode = 'control' | 'balanced' | 'ultra-lite' | 'aggressive';
export type BenchmarkProfile = 'standard' | 'experimental';
export type BenchmarkRunMode = BenchmarkMode | 'session-gc';
export type BenchmarkStatus =
  | 'preparing'
  | 'reloading'
  | 'running'
  | 'paused-busy'
  | 'paused-user'
  | 'retrying'
  | 'stopped'
  | 'complete'
  | 'failed';

export type GrowthLevel = 'stable' | 'moderate growth' | 'strong growth' | 'n/a';
export type BenchmarkConclusion = 'proven improvement' | 'partial improvement' | 'inconclusive' | 'regression';

export interface BenchmarkSample {
  timestamp: number;
  mode: BenchmarkRunMode;
  switchCount: number;
  conversationId: string | null;
  renderedRounds: number;
  renderedMessages: number;
  configuredHistoryCount: number;
  historyUnit: 'message' | 'round';
  limitedByDomBudget: boolean;
  conversationDomNodes: number;
  activeConversationDomNodes: number;
  documentDomNodes: number;
  cleanupCount: number;
  hardSwitchCount: number;
  networkMode: NetworkMode;
  networkRequestedTurns: number | null;
  networkEffectiveTurns: number | null;
  jsHeapMb: number | null;
  switchLatencyMs: number | null;
  longTaskCount: number | null;
  longTaskBlockingMs: number | null;
  route: string;
}

export interface GrowthAnalysis {
  level: GrowthLevel;
  sampleCount: number;
  first: number | null;
  last: number | null;
  relativeGrowth: number | null;
  slopePerSwitch: number | null;
  positiveStepFraction: number | null;
}

export interface BenchmarkModeAnalysis {
  conversationDom: GrowthAnalysis;
  documentDom: GrowthAnalysis;
  heap: GrowthAnalysis;
  medianSwitchLatencyMs: number | null;
  p95SwitchLatencyMs: number | null;
  spaRetainedStateLikely: boolean;
  note: string | null;
}

export interface BenchmarkModeResult {
  mode: BenchmarkMode;
  samples: BenchmarkSample[];
  switchLatenciesMs: number[];
  errors: string[];
  completedSwitches: number;
  analysis: BenchmarkModeAnalysis | null;
}

export interface SessionGcBenchmarkResult {
  mode: 'session-gc';
  samples: BenchmarkSample[];
  switchLatenciesMs: number[];
  errors: string[];
  completedSwitches: number;
  analysis: BenchmarkModeAnalysis | null;
  hardReloadCount: number;
  longTaskCountCarry: number;
  longTaskBlockingCarryMs: number;
}

export interface BenchmarkEnvironment {
  userAgent: string;
  buildId: string;
  startedAt: number;
  conversationCount: number;
  switchesPerMode: number;
  loops: number;
  rendererMemory: 'not-collected';
}

export interface BenchmarkState {
  version: 1;
  sessionId: string;
  profile: BenchmarkProfile;
  status: BenchmarkStatus;
  phase: 'primary' | 'session-gc';
  pauseReason: string | null;
  startedAt: number;
  completedAt: number | null;
  loops: 5 | 10;
  switchesPerMode: number;
  conversationIds: string[];
  modeOrder: BenchmarkMode[];
  modeIndex: number;
  currentSwitch: number;
  expectedConversationId: string | null;
  retryCount: number;
  originalConfig: GuardConfig;
  environment: BenchmarkEnvironment;
  results: Record<BenchmarkMode, BenchmarkModeResult>;
  sessionGc: SessionGcBenchmarkResult | null;
  sessionGcPendingStartedAt: number | null;
  sessionGcPendingTarget: string | null;
  conclusion: BenchmarkConclusion | null;
  conclusionReason: string | null;
}

export const BENCHMARK_SESSION_KEY = 'csg.benchmark.session.v1';
export const STANDARD_BENCHMARK_MODES: BenchmarkMode[] = ['control', 'balanced', 'ultra-lite'];
export const EXPERIMENTAL_BENCHMARK_MODES: BenchmarkMode[] = ['aggressive'];
export const BENCHMARK_MODES: BenchmarkMode[] = ['control', 'balanced', 'ultra-lite', 'aggressive'];

export function emptyModeResult(mode: BenchmarkMode): BenchmarkModeResult {
  return {
    mode,
    samples: [],
    switchLatenciesMs: [],
    errors: [],
    completedSwitches: 0,
    analysis: null
  };
}

export function emptySessionGcResult(): SessionGcBenchmarkResult {
  return {
    mode: 'session-gc',
    samples: [],
    switchLatenciesMs: [],
    errors: [],
    completedSwitches: 0,
    analysis: null,
    hardReloadCount: 0,
    longTaskCountCarry: 0,
    longTaskBlockingCarryMs: 0
  };
}

export function benchmarkTargets(conversationIds: string[], loops: number): string[] {
  if (conversationIds.length < 5) return [];
  const [a, b, c, d, e] = conversationIds;
  if (!a || !b || !c || !d || !e) return [];
  // The final E is the loop-boundary transition. This preserves the requested
  // A→B→C→D→E and E→A→C→B→D traversal while ensuring every counted step is
  // an actual conversation change rather than a no-op E→E navigation.
  const cycle = [a, b, c, d, e, a, c, b, d, e];
  return Array.from({ length: Math.max(1, Math.trunc(loops)) }, () => cycle).flat();
}

function regressionSlope(xs: number[], ys: number[]): number | null {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const x = xs[index];
    const y = ys[index];
    if (x === undefined || y === undefined) continue;
    numerator += (x - meanX) * (y - meanY);
    denominator += (x - meanX) ** 2;
  }
  return denominator > 0 ? numerator / denominator : null;
}

export function analyzeGrowth(
  samples: BenchmarkSample[],
  selector: (sample: BenchmarkSample) => number | null
): GrowthAnalysis {
  const points = samples
    .map((sample) => ({ x: sample.switchCount, y: selector(sample) }))
    .filter((point): point is { x: number; y: number } => point.y !== null && Number.isFinite(point.y));

  if (points.length < 2) {
    return {
      level: 'n/a',
      sampleCount: points.length,
      first: points[0]?.y ?? null,
      last: points.at(-1)?.y ?? null,
      relativeGrowth: null,
      slopePerSwitch: null,
      positiveStepFraction: null
    };
  }

  const first = points[0]?.y ?? 0;
  const last = points.at(-1)?.y ?? first;
  const relativeGrowth = first > 0 ? (last - first) / first : null;
  const slopePerSwitch = regressionSlope(points.map((point) => point.x), points.map((point) => point.y));
  let positiveSteps = 0;
  let comparableSteps = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]?.y;
    const current = points[index]?.y;
    if (previous === undefined || current === undefined) continue;
    const tolerance = Math.max(Math.abs(previous) * 0.02, 1);
    comparableSteps += 1;
    if (current - previous > tolerance) positiveSteps += 1;
  }
  const positiveStepFraction = comparableSteps > 0 ? positiveSteps / comparableSteps : null;
  const normalizedSlopePerTen = first > 0 && slopePerSwitch !== null ? (slopePerSwitch * 10) / first : 0;

  let level: GrowthLevel = 'stable';
  if (
    relativeGrowth !== null && relativeGrowth > 0.35 &&
    (positiveStepFraction ?? 0) >= 0.65 && normalizedSlopePerTen > 0.04
  ) {
    level = 'strong growth';
  } else if (
    (relativeGrowth !== null && relativeGrowth > 0.15) ||
    (positiveStepFraction ?? 0) >= 0.7 && normalizedSlopePerTen > 0.02
  ) {
    level = 'moderate growth';
  }

  return {
    level,
    sampleCount: points.length,
    first,
    last,
    relativeGrowth,
    slopePerSwitch,
    positiveStepFraction
  };
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index] ?? null;
}

export function analyzeMode(result: BenchmarkModeResult | SessionGcBenchmarkResult): BenchmarkModeAnalysis {
  const conversationDom = analyzeGrowth(result.samples, (sample) => sample.conversationDomNodes);
  const documentDom = analyzeGrowth(result.samples, (sample) => sample.documentDomNodes);
  const heap = analyzeGrowth(result.samples, (sample) => sample.jsHeapMb);
  const medianSwitchLatencyMs = percentile(result.switchLatenciesMs, 0.5);
  const p95SwitchLatencyMs = percentile(result.switchLatenciesMs, 0.95);
  const spaRetainedStateLikely = conversationDom.level === 'stable' && heap.level === 'strong growth';

  return {
    conversationDom,
    documentDom,
    heap,
    medianSwitchLatencyMs,
    p95SwitchLatencyMs,
    spaRetainedStateLikely,
    note: spaRetainedStateLikely
      ? 'DOM stable, heap continues growing; likely retained SPA state/cache.'
      : null
  };
}

function growthRank(level: GrowthLevel): number {
  if (level === 'strong growth') return 3;
  if (level === 'moderate growth') return 2;
  if (level === 'stable') return 1;
  return 0;
}

function dominantGrowth(analysis: BenchmarkModeAnalysis | null): GrowthLevel {
  if (!analysis) return 'n/a';
  return [analysis.heap.level, analysis.documentDom.level, analysis.conversationDom.level]
    .sort((a, b) => growthRank(b) - growthRank(a))[0] ?? 'n/a';
}

export function preliminaryConclusion(
  results: Record<BenchmarkMode, BenchmarkModeResult>
): { conclusion: BenchmarkConclusion; reason: string } {
  const control = results.control.analysis;
  const balanced = results.balanced.analysis;
  const ultraLite = results['ultra-lite'].analysis;
  if (!control || !balanced || !ultraLite) {
    return { conclusion: 'inconclusive', reason: 'Standard Validation requires complete Control, Balanced, and Ultra Lite analyses.' };
  }
  if ([results.control, results.balanced, results['ultra-lite']].some((result) => result.errors.length > 0)) {
    return { conclusion: 'inconclusive', reason: 'At least one Standard Validation mode recorded navigation or stabilization errors.' };
  }

  const controlRank = growthRank(dominantGrowth(control));
  const balancedRank = growthRank(dominantGrowth(balanced));
  const ultraRank = growthRank(dominantGrowth(ultraLite));
  const controlHeapRank = growthRank(control.heap.level);
  const ultraHeapRank = growthRank(ultraLite.heap.level);
  const ultraDomStable = ultraLite.conversationDom.level === 'stable' && ultraLite.documentDom.level === 'stable';
  const ultraLatencyRegression =
    balanced.p95SwitchLatencyMs !== null && ultraLite.p95SwitchLatencyMs !== null &&
    ultraLite.p95SwitchLatencyMs > balanced.p95SwitchLatencyMs * 1.5;

  if (controlRank <= 1) {
    if (balancedRank > controlRank || ultraRank > controlRank) {
      return { conclusion: 'regression', reason: 'Control stayed stable while an optimized mode showed more growth.' };
    }
    return { conclusion: 'inconclusive', reason: 'Control did not reproduce sustained growth strongly enough to prove the target problem.' };
  }

  if (balancedRank > controlRank || ultraRank > controlRank || ultraLatencyRegression) {
    return { conclusion: 'regression', reason: 'An optimized mode increased the growth class or Ultra Lite introduced a severe p95 latency regression versus Balanced.' };
  }

  if (control.heap.level === 'n/a') {
    if (ultraDomStable && ultraRank < controlRank) {
      return { conclusion: 'partial improvement', reason: 'Ultra Lite reduced DOM growth, but JS heap was unavailable so retained-memory improvement is not proven.' };
    }
    return { conclusion: 'inconclusive', reason: 'JS heap was unavailable and the remaining metrics do not prove retained-memory improvement.' };
  }

  if (controlHeapRank >= 2 && ultraHeapRank === 1 && ultraDomStable && !ultraLatencyRegression) {
    const balancedHeapStable = balanced.heap.level === 'stable';
    const ultraMedianNoWorse =
      balanced.medianSwitchLatencyMs === null || ultraLite.medianSwitchLatencyMs === null ||
      ultraLite.medianSwitchLatencyMs <= balanced.medianSwitchLatencyMs * 1.2;
    return {
      conclusion: 'proven improvement',
      reason: balancedHeapStable && ultraMedianNoWorse
        ? 'Control reproduced heap growth while both Balanced and Ultra Lite stayed stable; Ultra Lite preserved stability without a material median-latency regression.'
        : 'Control reproduced heap growth and Ultra Lite reached stable heap/DOM working sets without a severe p95 latency regression.'
    };
  }

  if (ultraRank < controlRank || balancedRank < controlRank) {
    return { conclusion: 'partial improvement', reason: 'At least one optimized mode reduced the observed growth class but did not fully prove a stable retained-memory working set.' };
  }
  return { conclusion: 'inconclusive', reason: 'Balanced and Ultra Lite did not materially separate from Control in this run.' };
}

function formatNumber(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? 'N/A' : value.toFixed(digits);
}

function formatGrowth(analysis: GrowthAnalysis): string {
  if (analysis.level === 'n/a') return 'N/A';
  const relative = analysis.relativeGrowth === null ? 'N/A' : `${(analysis.relativeGrowth * 100).toFixed(1)}%`;
  return `${analysis.level} (${relative}, slope ${formatNumber(analysis.slopePerSwitch, 3)}/switch)`;
}

function modeSection(result: BenchmarkModeResult | SessionGcBenchmarkResult): string {
  const analysis = result.analysis;
  const rows = result.samples.map((sample) => {
    const networkTurns = sample.networkRequestedTurns === null
      ? 'N/A'
      : `${sample.networkRequestedTurns}→${sample.networkEffectiveTurns ?? sample.networkRequestedTurns}`;
    return `| ${sample.switchCount} | ${sample.renderedRounds} | ${sample.documentDomNodes} | ${sample.conversationDomNodes} | ${formatNumber(sample.jsHeapMb)} | ${formatNumber(sample.switchLatencyMs)} | ${sample.cleanupCount} | ${sample.networkMode} | ${networkTurns} | ${sample.longTaskCount ?? 'N/A'} | ${formatNumber(sample.longTaskBlockingMs)} |`;
  }).join('\n');
  return `## ${result.mode[0]?.toUpperCase() ?? ''}${result.mode.slice(1)}\n\n` +
    `| Switch | Rendered rounds | Document DOM | Conversation DOM | JS Heap MB | Last switch ms | Cleanup | Network | Turns | Long tasks | Blocking ms |\n` +
    `|---:|---:|---:|---:|---:|---:|---:|---|---|---:|---:|\n${rows || '| N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |'}\n\n` +
    `- Document DOM: ${analysis ? formatGrowth(analysis.documentDom) : 'N/A'}\n` +
    `- Conversation DOM: ${analysis ? formatGrowth(analysis.conversationDom) : 'N/A'}\n` +
    `- JS Heap: ${analysis ? formatGrowth(analysis.heap) : 'N/A'}\n` +
    `- Median switch latency: ${analysis ? formatNumber(analysis.medianSwitchLatencyMs) : 'N/A'} ms\n` +
    `- p95 switch latency: ${analysis ? formatNumber(analysis.p95SwitchLatencyMs) : 'N/A'} ms\n` +
    `${analysis?.note ? `- Diagnostic: ${analysis.note}\n` : ''}` +
    `${result.errors.length ? `- Errors: ${result.errors.join('; ')}\n` : ''}`;
}

export function benchmarkReport(state: BenchmarkState): string {
  const conclusion = state.conclusion ?? 'inconclusive';
  const comparisonRows = [
    ...state.modeOrder.map((mode) => {
      const analysis = state.results[mode].analysis;
      return `| ${mode} | ${analysis?.conversationDom.level ?? 'N/A'} | ${analysis?.documentDom.level ?? 'N/A'} | ${analysis?.heap.level ?? 'N/A'} | ${formatNumber(analysis?.medianSwitchLatencyMs ?? null)} | ${formatNumber(analysis?.p95SwitchLatencyMs ?? null)} |`;
    }),
    ...(state.sessionGc ? [
      `| session-gc | ${state.sessionGc.analysis?.conversationDom.level ?? 'N/A'} | ${state.sessionGc.analysis?.documentDom.level ?? 'N/A'} | ${state.sessionGc.analysis?.heap.level ?? 'N/A'} | ${formatNumber(state.sessionGc.analysis?.medianSwitchLatencyMs ?? null)} | ${formatNumber(state.sessionGc.analysis?.p95SwitchLatencyMs ?? null)} |`
    ] : [])
  ].join('\n');
  const modeSections = state.modeOrder.map((mode) => modeSection(state.results[mode])).join('\n\n');

  return `# ChatGPT Session Guard — Real Browser Benchmark\n\n` +
    `## Environment\n\n` +
    `- Date: ${new Date(state.environment.startedAt).toISOString()}\n` +
    `- Chrome UA: ${state.environment.userAgent}\n` +
    `- Extension build: ${state.environment.buildId}\n` +
    `- Benchmark profile: ${state.profile}\n` +
    `- Conversations: ${state.environment.conversationCount}\n` +
    `- Switches per mode: ${state.environment.switchesPerMode}\n` +
    `- Renderer process memory: N/A (optional external metric; not collected by the extension)\n\n` +
    `${modeSections}\n\n` +
    `${state.sessionGc ? `${modeSection(state.sessionGc)}\n- Controlled hard reloads: ${state.sessionGc.hardReloadCount}\n\n` : ''}` +
    `## Comparison\n\n` +
    `| Mode | Conversation DOM growth | Document DOM growth | Heap growth | Median latency ms | p95 latency ms |\n` +
    `|---|---|---|---|---:|---:|\n${comparisonRows}\n\n` +
    `## Preliminary Conclusion\n\n` +
    `**${conclusion}**\n\n${state.conclusionReason ?? 'The benchmark did not produce enough evidence for a stronger conclusion.'}\n\n` +
    `${state.profile === 'experimental' && state.results.aggressive.analysis?.spaRetainedStateLikely ? '**Session GC test recommended.** Aggressive kept conversation DOM stable while heap still showed strong growth.\n' : ''}` +
    `\nThis report is generated from local performance counters only. It contains conversation IDs/routes for test coordination, but never conversation text.\n`;
}

export function benchmarkFilename(prefix: 'benchmark-results' | 'benchmark-report', timestamp: number, extension: 'json' | 'md'): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${prefix}-${stamp}.${extension}`;
}
