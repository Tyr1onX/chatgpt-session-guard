import type { BenchmarkState } from './benchmark';
import type { NetworkMode } from './events';

export interface DebugMetrics {
  conversationId: string | null;
  spaSwitchCount: number;
  renderedRounds: number;
  totalRounds: number;
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
  | { type: 'csg:benchmark-start'; loops: 5 | 10 }
  | { type: 'csg:benchmark-stop' }
  | { type: 'csg:benchmark-resume' }
  | { type: 'csg:session-gc-start' };

export interface PopupResponse {
  metrics?: DebugMetrics;
  benchmark?: BenchmarkState | null;
  ok?: boolean;
  error?: string;
}
