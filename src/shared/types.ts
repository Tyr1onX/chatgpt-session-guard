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
  cleanupCount: number;
  hardSwitchCount: number;
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
  cleanupCount: 0,
  hardSwitchCount: 0,
  jsHeapMb: null,
  lastUpdatedAt: 0
};

export interface PopupRequest {
  type: 'csg:get-state';
}

export interface PopupResponse {
  metrics: DebugMetrics;
}
