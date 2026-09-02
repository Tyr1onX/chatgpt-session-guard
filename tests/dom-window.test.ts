import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/shared/config';
import { DomRollingWindow, findTurnElements } from '../src/content/dom-window';

function addRound(index: number, childCount = 4): void {
  for (const role of ['user', 'assistant'] as const) {
    const turn = document.createElement('article');
    turn.setAttribute('data-testid', `conversation-turn-${index}-${role}`);
    const message = document.createElement('div');
    message.setAttribute('data-message-author-role', role);
    for (let child = 0; child < childCount; child += 1) message.appendChild(document.createElement('span'));
    if (role === 'assistant' && index === 19) {
      const tool = document.createElement('div');
      tool.dataset.testid = 'tool-card';
      const thinking = document.createElement('div');
      thinking.dataset.testid = 'thinking-block';
      message.append(tool, thinking);
    }
    turn.appendChild(message);
    document.body.appendChild(turn);
  }
}

function populate(rounds = 20): void {
  for (let index = 0; index < rounds; index += 1) addRound(index);
}

describe('DOM rolling window', () => {
  beforeEach(() => {
    document.head.querySelector('#csg-window-styles')?.remove();
    document.body.replaceChildren();
    populate();
  });

  it('Safe keeps DOM attached and marks older turns without deleting descendants', () => {
    const guard = new DomRollingWindow();
    const before = document.querySelectorAll('*').length;
    const stats = guard.apply(normalizeConfig({ ...DEFAULT_CONFIG, mode: 'safe', historyUnit: 'round', historyCount: 4, domBudget: 1000 }));
    expect(stats.renderedRounds).toBe(4);
    expect(findTurnElements()).toHaveLength(40);
    expect(document.querySelectorAll('.csg-safe-windowed').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('*').length).toBeGreaterThanOrEqual(before);
  });

  it('Balanced preserves the 8-round default behavior and can target 4 rounds', () => {
    const guard = new DomRollingWindow();
    const oldest = findTurnElements()[0];
    const descendantsBefore = oldest?.querySelectorAll('*').length ?? 0;
    const stats = guard.apply(normalizeConfig({ ...DEFAULT_CONFIG, mode: 'balanced', historyUnit: 'round', historyCount: 4, domBudget: 1000 }));
    expect(stats.renderedRounds).toBe(4);
    expect(oldest?.classList.contains('csg-balanced-hidden')).toBe(true);
    expect(oldest?.querySelectorAll('*').length).toBe(descendantsBefore);
    expect(document.getElementById('csg-history-placeholder')).not.toBeNull();
  });

  it('1-message mode keeps only the newest visible message when ChatGPT is settled', () => {
    const guard = new DomRollingWindow();
    const stats = guard.apply(normalizeConfig({ ...DEFAULT_CONFIG, mode: 'ultra-lite', historyUnit: 'message', historyCount: 1, domBudget: 7000 }));
    expect(stats.renderedMessages).toBe(1);
    expect(stats.renderedRounds).toBe(1);
    const kept = findTurnElements().filter((turn) => !turn.classList.contains('csg-balanced-hidden'));
    expect(kept).toHaveLength(1);
    expect(kept[0]?.querySelector('[data-testid="tool-card"]')).not.toBeNull();
    expect(kept[0]?.querySelector('[data-testid="thinking-block"]')).not.toBeNull();
  });

  it('1-message mode expands to the current safety round while streaming', () => {
    const stop = document.createElement('button');
    stop.dataset.testid = 'stop-button';
    stop.style.position = 'fixed';
    document.body.appendChild(stop);
    const guard = new DomRollingWindow();
    const stats = guard.apply(normalizeConfig({ ...DEFAULT_CONFIG, mode: 'ultra-lite', historyUnit: 'message', historyCount: 1 }));
    expect(stats.renderedMessages).toBeGreaterThanOrEqual(2);
    expect(stats.renderedRounds).toBe(1);
  });

  it('temporary manual expansion increases only the matching conversation working set', () => {
    const guard = new DomRollingWindow();
    const config = normalizeConfig({
      ...DEFAULT_CONFIG,
      historyUnit: 'round',
      historyCount: 1,
      historyExpansion: 10,
      historyExpansionConversationId: 'abc'
    });
    expect(guard.apply(config, 'abc').renderedRounds).toBe(11);
    expect(guard.apply(config, 'other').renderedRounds).toBe(1);
  });

  it('Aggressive remains experimental and never prunes a protected dialog turn', () => {
    const turns = findTurnElements();
    const protectedTurn = turns[4];
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.style.position = 'fixed';
    protectedTurn?.appendChild(dialog);

    const guard = new DomRollingWindow();
    const stats = guard.apply(normalizeConfig({ ...DEFAULT_CONFIG, mode: 'aggressive', historyUnit: 'round', historyCount: 4, domBudget: 1000 }));
    expect(stats.totalRounds).toBe(20);
    expect(turns[0]?.dataset.csgPruned).toBe('true');
    expect((turns[0]?.querySelectorAll('*').length ?? 1)).toBe(0);
    expect(protectedTurn?.dataset.csgPruned).not.toBe('true');
  });

  it('cleanup removes recoverable Safe/Balanced presentation state', () => {
    const guard = new DomRollingWindow();
    guard.apply(normalizeConfig({ ...DEFAULT_CONFIG, mode: 'balanced', historyUnit: 'round', historyCount: 4, domBudget: 1000 }));
    expect(document.querySelectorAll('.csg-balanced-hidden').length).toBeGreaterThan(0);
    guard.cleanup();
    expect(document.querySelectorAll('.csg-balanced-hidden').length).toBe(0);
    expect(document.getElementById('csg-history-placeholder')).toBeNull();
  });
  it('keeps the existing Balanced default at 8 configured rounds when budget allows', () => {
    const guard = new DomRollingWindow();
    const stats = guard.apply(DEFAULT_CONFIG);
    expect(stats.renderedRounds).toBe(8);
    expect(stats.configuredHistoryCount).toBe(8);
    expect(stats.historyUnit).toBe('round');
  });

  it('Temporary Full History disables DOM limiting without changing the stored history target', () => {
    const guard = new DomRollingWindow();
    const config = normalizeConfig({ ...DEFAULT_CONFIG, historyUnit: 'message', historyCount: 1, temporaryFullHistory: true });
    const stats = guard.apply(config);
    expect(stats.renderedMessages).toBe(stats.totalMessages);
    expect(document.querySelectorAll('.csg-balanced-hidden')).toHaveLength(0);
    expect(stats.configuredHistoryCount).toBe(1);
  });

  it('never splits the last configured round just to satisfy DOM budget', () => {
    document.body.replaceChildren();
    addRound(0, 4000);
    const guard = new DomRollingWindow();
    const config = normalizeConfig({ ...DEFAULT_CONFIG, mode: 'ultra-lite', historyUnit: 'round', historyCount: 1, domBudget: 2000 });
    const stats = guard.apply(config);
    expect(stats.renderedRounds).toBe(1);
    expect(stats.renderedMessages).toBe(2);
    expect(stats.limitedByDomBudget).toBe(false);
  });

});
