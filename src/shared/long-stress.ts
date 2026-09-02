import type { GuardConfig, HistoryUnit } from './config';

export type LongStressStatus = 'preparing' | 'reloading' | 'measuring' | 'complete' | 'failed' | 'stopped';

export interface LongStressSetting {
  historyUnit: HistoryUnit;
  historyCount: number;
  label: string;
}

export interface LongStressSample {
  timestamp: number;
  label: string;
  historyUnit: HistoryUnit;
  historyCount: number;
  renderedMessages: number;
  renderedRounds: number;
  conversationDomNodes: number;
  activeConversationDomNodes: number;
  documentDomNodes: number;
  jsHeapMb: number | null;
  longTaskCount: number | null;
  longTaskBlockingMs: number | null;
  inputLatencyProxyMs: number | null;
  scrollWorkProxyMs: number | null;
  networkMode: string;
  networkRequestedTurns: number | null;
  networkEffectiveTurns: number | null;
  limitedByDomBudget: boolean;
}

export interface LongStressState {
  version: 1;
  status: LongStressStatus;
  conversationId: string;
  buildId: string;
  startedAt: number;
  completedAt: number | null;
  stepIndex: number;
  originalConfig: GuardConfig;
  samples: LongStressSample[];
  error: string | null;
}

export const LONG_STRESS_SESSION_KEY = 'csg.long-stress.v1';

export const LONG_STRESS_SETTINGS: LongStressSetting[] = [
  { historyUnit: 'round', historyCount: 8, label: '8 rounds' },
  { historyUnit: 'round', historyCount: 4, label: '4 rounds' },
  { historyUnit: 'round', historyCount: 2, label: '2 rounds' },
  { historyUnit: 'round', historyCount: 1, label: '1 round' },
  { historyUnit: 'message', historyCount: 1, label: '1 message' }
];

function format(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'N/A' : value.toFixed(1);
}

export function longStressReport(state: LongStressState): string {
  const rows = state.samples.map((sample) => {
    const turns = sample.networkRequestedTurns === null
      ? 'N/A'
      : `${sample.networkRequestedTurns}→${sample.networkEffectiveTurns ?? sample.networkRequestedTurns}`;
    return `| ${sample.label} | ${sample.renderedMessages} | ${sample.renderedRounds} | ${sample.activeConversationDomNodes} | ${sample.conversationDomNodes} | ${sample.documentDomNodes} | ${format(sample.jsHeapMb)} | ${sample.longTaskCount ?? 'N/A'} | ${format(sample.longTaskBlockingMs)} | ${format(sample.scrollWorkProxyMs)} | ${format(sample.inputLatencyProxyMs)} | ${turns} | ${sample.limitedByDomBudget ? 'yes' : 'no'} |`;
  }).join('\n');
  return `# ChatGPT Session Guard — Long Conversation Stress\n\n` +
    `- Date: ${new Date(state.startedAt).toISOString()}\n` +
    `- Extension build: ${state.buildId}\n` +
    `- Conversation: ${state.conversationId}\n` +
    `- Status: ${state.status}\n\n` +
    `| History | Visible messages | Visible rounds | Active DOM | Conversation DOM | Document DOM | Heap MB | Long tasks | Blocking ms | Scroll proxy ms | Input proxy ms | Network turns | Budget-limited |\n` +
    `|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|\n${rows || '| N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |'}\n\n` +
    `${state.error ? `Error: ${state.error}\n\n` : ''}` +
    `This stress test compares browser-side history working-set settings on one existing conversation. It does not create messages or store conversation text.\n`;
}

export function longStressFilename(prefix: 'long-stress-results' | 'long-stress-report', timestamp: number, extension: 'json' | 'md'): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${prefix}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.${extension}`;
}
