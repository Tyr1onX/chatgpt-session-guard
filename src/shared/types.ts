import type { BenchmarkState } from './benchmark';
import type { HistoryUnit } from './config';
import type { LongStressState } from './long-stress';
import type { NetworkMode } from './events';

export interface DebugMetrics {
  conversationId: string | null;
  spaSwitchCount: number;
  renderedRounds: number;
  totalRounds: number;
  renderedMessages: number;
  totalMessages: number;
  configuredHistoryCount: number;
  historyUnit: HistoryUnit;
  limitedByDomBudget: boolean;
  conversationDomNodes: number;
  activeConversationDomNodes: number;
  totalDocumentDomNodes: number;
  networkMode: NetworkMode;
  networkModified: boolean;
  networkRequestedTurns: number | null;
  networkEffectiveTurns: number | null;
  cleanupCount: number;
  hardSwitchCount: number;
  switchLatencyMs: number | null;
  jsHeapMb: number | null;
  lastUpdatedAt: number;
}

export const EMPTY_METRICS: DebugMetrics = {
  conversationId: null,
  spaSwitchCount: 0,
  renderedRounds: 0,
  totalRounds: 0,
  renderedMessages: 0,
  totalMessages: 0,
  configuredHistoryCount: 0,
  historyUnit: 'round',
  limitedByDomBudget: false,
  conversationDomNodes: 0,
  activeConversationDomNodes: 0,
  totalDocumentDomNodes: 0,
  networkMode: 'unknown',
  networkModified: false,
  networkRequestedTurns: null,
  networkEffectiveTurns: null,
  cleanupCount: 0,
  hardSwitchCount: 0,
  switchLatencyMs: null,
  jsHeapMb: null,
  lastUpdatedAt: 0
};

export type PopupRequest =
  | { type: 'csg:get-state' }
  | { type: 'csg:benchmark-start'; loops: 5 | 10; profile?: 'standard' | 'experimental' }
  | { type: 'csg:benchmark-stop' }
  | { type: 'csg:benchmark-resume' }
  | { type: 'csg:session-gc-start' }
  | { type: 'csg:history-load-previous' }
  | { type: 'csg:temporary-full-history' }
  | { type: 'csg:restore-lightweight' }
  | { type: 'csg:long-stress-start' }
  | { type: 'csg:long-stress-stop' };

export interface PopupResponse {
  metrics?: DebugMetrics;
  benchmark?: BenchmarkState | null;
  longStress?: LongStressState | null;
  ok?: boolean;
  error?: string;
}
