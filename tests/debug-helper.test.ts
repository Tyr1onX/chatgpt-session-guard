import { beforeEach, describe, expect, it } from 'vitest';
import { installDebugHelper } from '../src/main-world/debug-helper';
import { EVENTS, dispatchStringEvent } from '../src/shared/events';

describe('debug helper', () => {
  beforeEach(() => {
    delete window.__CSG_DEBUG__;
  });

  it('exposes sanitized snapshots without conversation content', () => {
    installDebugHelper();
    dispatchStringEvent(EVENTS.debugMetrics, {
      conversationId: 'conv-123',
      spaSwitchCount: 10,
      renderedRounds: 8,
      totalRounds: 42,
      conversationDomNodes: 900,
      activeConversationDomNodes: 300,
      totalDocumentDomNodes: 1800,
      networkMode: 'paginated',
      networkModified: true,
      networkRequestedTurns: 40,
      networkEffectiveTurns: 8,
      cleanupCount: 9,
      hardSwitchCount: 0,
      switchLatencyMs: 123.4,
      jsHeapMb: 512.3,
      lastUpdatedAt: 123456,
      secretConversationText: 'must-not-leak'
    });

    const snapshot = window.__CSG_DEBUG__?.snapshot();
    expect(snapshot).toMatchObject({
      conversationId: 'conv-123',
      spaSwitchCount: 10,
      networkMode: 'paginated',
      networkRequestedTurns: 40,
      networkEffectiveTurns: 8,
      switchLatencyMs: 123.4
    });
    expect(snapshot).not.toHaveProperty('secretConversationText');
    expect(window.__CSG_DEBUG__?.history()).toHaveLength(1);
  });

  it('keeps explicit history bounded and clearable', () => {
    installDebugHelper();
    dispatchStringEvent(EVENTS.debugMetrics, {
      conversationId: null,
      spaSwitchCount: 0,
      renderedRounds: 0,
      totalRounds: 0,
      conversationDomNodes: 0,
      activeConversationDomNodes: 0,
      totalDocumentDomNodes: 10,
      networkMode: 'unknown',
      networkModified: false,
      cleanupCount: 0,
      hardSwitchCount: 0,
      lastUpdatedAt: 1
    });
    window.__CSG_DEBUG__?.snapshot();
    expect(window.__CSG_DEBUG__?.history()).toHaveLength(1);
    window.__CSG_DEBUG__?.clearHistory();
    expect(window.__CSG_DEBUG__?.history()).toEqual([]);
  });
});
