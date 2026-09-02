import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/shared/config';
import {
  DomRollingWindow,
  buildDomRounds,
  findTurnElements,
  mutationNeedsConversationEvaluate
} from '../src/content/dom-window';

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
    document.documentElement.querySelector('#csg-window-styles')?.remove();
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

  it('1-message mode pins to the current whole round while streaming', () => {
    const stop = document.createElement('button');
    stop.dataset.testid = 'stop-button';
    stop.style.position = 'fixed';
    document.body.appendChild(stop);
    const guard = new DomRollingWindow();
    const stats = guard.apply(normalizeConfig({ ...DEFAULT_CONFIG, mode: 'ultra-lite', historyUnit: 'message', historyCount: 1 }));
    expect(stats.renderedMessages).toBeGreaterThanOrEqual(2);
    expect(stats.renderedRounds).toBe(1);
    expect(stats.generationActive).toBe(true);
    expect(stats.boundaryIndex).toBe(stats.lastVisibleUserIndex);
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

  it('cleanup restores recoverable Safe/Balanced presentation state when explicitly requested', () => {
    const guard = new DomRollingWindow();
    guard.apply(normalizeConfig({ ...DEFAULT_CONFIG, mode: 'balanced', historyUnit: 'round', historyCount: 4, domBudget: 1000 }));
    expect(document.querySelectorAll('.csg-balanced-hidden').length).toBeGreaterThan(0);
    guard.cleanup();
    expect(document.querySelectorAll('.csg-balanced-hidden').length).toBe(0);
    expect(document.getElementById('csg-history-placeholder')).toBeNull();
  });

  it('navigation cleanup does not flash the full hidden conversation', () => {
    const guard = new DomRollingWindow();
    guard.apply(normalizeConfig({ ...DEFAULT_CONFIG, mode: 'ultra-lite', historyUnit: 'round', historyCount: 1 }));
    const hiddenBefore = document.querySelectorAll('.csg-balanced-hidden').length;
    expect(hiddenBefore).toBeGreaterThan(0);
    guard.cleanupForNavigation();
    expect(document.querySelectorAll('.csg-balanced-hidden')).toHaveLength(hiddenBefore);
    expect(document.getElementById('csg-history-placeholder')).toBeNull();
    guard.restoreAllVisualState();
    expect(document.querySelectorAll('.csg-balanced-hidden')).toHaveLength(0);
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

  it('uses visible user turns as the only round boundaries', () => {
    document.body.replaceChildren();
    const make = (role: 'user' | 'assistant' | 'unknown', id: string): void => {
      const turn = document.createElement('article');
      turn.setAttribute('data-testid', `conversation-turn-${id}`);
      if (role !== 'unknown') {
        const body = document.createElement('div');
        body.setAttribute('data-message-author-role', role);
        turn.appendChild(body);
      }
      document.body.appendChild(turn);
    };
    make('user', 'u1');
    make('unknown', 'thinking');
    make('unknown', 'tool');
    make('assistant', 'a1');
    make('unknown', 'citation');
    make('user', 'u2');
    make('assistant', 'a2');
    const rounds = buildDomRounds(findTurnElements());
    expect(rounds).toHaveLength(2);
    expect(rounds[0]?.turns).toHaveLength(5);
    expect(rounds[1]?.turns).toHaveLength(2);
  });

  it('keeps placeholder structure idempotent when its state is unchanged', () => {
    const guard = new DomRollingWindow();
    const cfg = normalizeConfig({ ...DEFAULT_CONFIG, mode: 'ultra-lite', historyUnit: 'round', historyCount: 1 });
    guard.apply(cfg);
    const placeholder = document.getElementById('csg-history-placeholder');
    const title = placeholder?.querySelector('.csg-history-title');
    const load = placeholder?.querySelector('[data-csg-action="load-previous"]');
    guard.apply(cfg);
    expect(document.getElementById('csg-history-placeholder')).toBe(placeholder);
    expect(placeholder?.querySelector('.csg-history-title')).toBe(title);
    expect(placeholder?.querySelector('[data-csg-action="load-previous"]')).toBe(load);
  });

  it('ignores extension-owned and ordinary streaming subtree mutations but reacts to topology changes', async () => {
    const guard = new DomRollingWindow();
    guard.apply(normalizeConfig({ ...DEFAULT_CONFIG, mode: 'ultra-lite', historyUnit: 'round', historyCount: 1 }));
    const placeholder = document.getElementById('csg-history-placeholder');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((next) => records.push(...next));
    observer.observe(document.body, { childList: true, subtree: true });

    placeholder?.querySelector('.csg-history-title')?.appendChild(document.createElement('span'));
    const activeTurn = findTurnElements().at(-1);
    activeTurn?.querySelector('[data-message-author-role]')?.appendChild(document.createElement('span'));
    const newTurn = document.createElement('article');
    newTurn.setAttribute('data-testid', 'conversation-turn-new');
    document.body.appendChild(newTurn);
    await Promise.resolve();
    observer.disconnect();

    const owned = records.filter((record) => (record.target as Element).closest?.('#csg-history-placeholder'));
    const streaming = records.filter((record) => (record.target as Element).closest?.('[data-testid^="conversation-turn-"]'));
    const topology = records.filter((record) => [...record.addedNodes].includes(newTurn));
    expect(mutationNeedsConversationEvaluate(owned)).toBe(false);
    expect(mutationNeedsConversationEvaluate(streaming)).toBe(false);
    expect(mutationNeedsConversationEvaluate(topology)).toBe(true);
  });
  it('keeps user-boundary semantics stable for 100 / 300 / 500 mixed tool-heavy rounds', () => {
    for (const roundCount of [100, 300, 500]) {
      document.body.replaceChildren();
      for (let index = 0; index < roundCount; index += 1) {
        const make = (role: 'user' | 'assistant' | 'unknown', suffix: string): void => {
          const turn = document.createElement('article');
          turn.setAttribute('data-testid', 'conversation-turn-' + index + '-' + suffix);
          if (role !== 'unknown') { const body = document.createElement('div'); body.setAttribute('data-message-author-role', role); turn.appendChild(body); }
          else { const tool = document.createElement('div'); tool.dataset.testid = suffix; tool.appendChild(document.createElement('span')); turn.appendChild(tool); }
          document.body.appendChild(turn);
        };
        make('user', 'user'); make('unknown', 'thinking'); make('unknown', 'tool'); make('assistant', 'assistant'); make('unknown', 'citation');
      }
      const guard = new DomRollingWindow();
      const stats = guard.apply(normalizeConfig({ ...DEFAULT_CONFIG, mode: 'ultra-lite', historyUnit: 'round', historyCount: 1 }));
      expect(stats.totalRounds).toBe(roundCount);
      expect(stats.renderedRounds).toBe(1);
      expect(stats.boundaryIndex).toBe((roundCount - 1) * 5);
    }
  });

  it('pins the active 1-round boundary while tool/thinking top-level nodes mount and replace during generation', () => {
    document.body.replaceChildren();
    addRound(0); addRound(1);
    const stop = document.createElement('button'); stop.dataset.testid = 'stop-button'; stop.style.position = 'fixed'; document.body.appendChild(stop);
    const guard = new DomRollingWindow();
    const cfg = normalizeConfig({ ...DEFAULT_CONFIG, mode: 'ultra-lite', historyUnit: 'round', historyCount: 1 });
    const first = guard.apply(cfg);
    const boundary = first.boundaryTurnId;
    const assistant = findTurnElements().at(-1);
    const tool = document.createElement('article'); tool.setAttribute('data-testid', 'conversation-turn-active-tool'); tool.appendChild(document.createElement('div')); assistant?.after(tool);
    const second = guard.apply(cfg);
    const replacement = document.createElement('article'); replacement.setAttribute('data-testid', 'conversation-turn-active-tool-replaced'); replacement.appendChild(document.createElement('div')); tool.replaceWith(replacement);
    const third = guard.apply(cfg);
    expect(first.generationActive).toBe(true);
    expect(second.boundaryTurnId).toBe(boundary);
    expect(third.boundaryTurnId).toBe(boundary);
    expect(second.renderedRounds).toBe(1);
    expect(third.renderedRounds).toBe(1);
  });

});
