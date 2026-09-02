import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/shared/config';
import type { DebugMetrics } from '../src/shared/types';
import { HardSwitchGuard, hasUnsafeInteractiveState } from '../src/content/hard-switch';

function metrics(overrides: Partial<DebugMetrics> = {}): DebugMetrics {
  return {
    conversationId: 'abc',
    spaSwitchCount: 30,
    renderedRounds: 8,
    totalRounds: 8,
    renderedMessages: 16,
    totalMessages: 16,
    configuredHistoryCount: 8,
    historyUnit: 'round',
    limitedByDomBudget: false,
    conversationDomNodes: 5000,
    activeConversationDomNodes: 5000,
    totalDocumentDomNodes: 20000,
    networkMode: 'legacy',
    networkModified: false,
    networkRequestedTurns: null,
    networkEffectiveTurns: null,
    cleanupCount: 30,
    hardSwitchCount: 0,
    switchLatencyMs: null,
    jsHeapMb: 900,
    lastUpdatedAt: Date.now(),
    ...overrides
  };
}

describe('Hard Switch Guard', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('is disabled by default', () => {
    const guard = new HardSwitchGuard();
    guard.observe(metrics({ spaSwitchCount: 1, totalDocumentDomNodes: 5000, jsHeapMb: 200 }));
    expect(guard.shouldHardReload(DEFAULT_CONFIG, metrics())).toBe(false);
  });

  it('requires repeated switches plus strong growth signals', () => {
    const guard = new HardSwitchGuard();
    guard.observe(metrics({ spaSwitchCount: 1, totalDocumentDomNodes: 5000, jsHeapMb: 200 }));
    const config = { ...DEFAULT_CONFIG, hardSwitchEnabled: true };
    expect(guard.shouldHardReload(config, metrics({ totalDocumentDomNodes: 15000, jsHeapMb: 600 }))).toBe(true);
  });

  it('blocks hard reload while a visible confirmation dialog exists', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.style.position = 'fixed';
    document.body.appendChild(dialog);
    expect(hasUnsafeInteractiveState()).toBe(true);

    const guard = new HardSwitchGuard();
    guard.observe(metrics({ spaSwitchCount: 1, totalDocumentDomNodes: 5000, jsHeapMb: 200 }));
    expect(guard.shouldHardReload({ ...DEFAULT_CONFIG, hardSwitchEnabled: true }, metrics())).toBe(false);
  });
});
