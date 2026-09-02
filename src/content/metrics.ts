import type { NetworkMode } from '../shared/events';
import type { DebugMetrics } from '../shared/types';
import type { DomWindowStats } from './dom-window';

interface MemoryPerformance extends Performance {
  memory?: { usedJSHeapSize?: number };
}

export function readJsHeapMb(): number | null {
  const bytes = (performance as MemoryPerformance).memory?.usedJSHeapSize;
  return typeof bytes === 'number' && Number.isFinite(bytes)
    ? Math.round((bytes / 1024 / 1024) * 10) / 10
    : null;
}

export function countDocumentNodes(): number {
  return document.documentElement ? 1 + document.documentElement.querySelectorAll('*').length : 0;
}

export function buildMetrics(params: {
  conversationId: string | null;
  spaSwitchCount: number;
  cleanupCount: number;
  hardSwitchCount: number;
  networkMode: NetworkMode;
  dom: DomWindowStats;
}): DebugMetrics {
  return {
    conversationId: params.conversationId,
    spaSwitchCount: params.spaSwitchCount,
    renderedRounds: params.dom.renderedRounds,
    totalRounds: params.dom.totalRounds,
    conversationDomNodes: params.dom.conversationDomNodes,
    activeConversationDomNodes: params.dom.activeConversationDomNodes,
    totalDocumentDomNodes: countDocumentNodes(),
    networkMode: params.networkMode,
    cleanupCount: params.cleanupCount,
    hardSwitchCount: params.hardSwitchCount,
    jsHeapMb: readJsHeapMb(),
    lastUpdatedAt: Date.now()
  };
}
