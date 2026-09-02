import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, applyModePreset } from '../src/shared/config';
import { EVENTS } from '../src/shared/events';
import { SessionController, type SessionTraceEvent } from '../src/content/session-controller';

function populate(rounds = 4): void {
  const main = document.createElement('main');
  for (let i = 0; i < rounds; i += 1) {
    for (const role of ['user', 'assistant'] as const) {
      const turn = document.createElement('article');
      turn.setAttribute('data-testid', `conversation-turn-${i}-${role}`);
      const message = document.createElement('div');
      message.setAttribute('data-message-author-role', role);
      turn.appendChild(message);
      main.appendChild(turn);
    }
  }
  document.body.appendChild(main);
}

describe('Session Switch Guard lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    document.documentElement.querySelector('#csg-window-styles')?.remove();
    history.replaceState(null, '', '/c/a');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cleans the previous conversation scope exactly once before initializing the next identity', () => {
    const controller = new SessionController(DEFAULT_CONFIG);
    controller.start();
    vi.runAllTimers();
    expect(controller.getMetrics().cleanupCount).toBe(0);

    history.replaceState(null, '', '/c/b');
    window.dispatchEvent(new Event(EVENTS.navigation));
    vi.runAllTimers();

    const afterSwitch = controller.getMetrics();
    expect(afterSwitch.conversationId).toBe('b');
    expect(afterSwitch.spaSwitchCount).toBe(1);
    expect(afterSwitch.cleanupCount).toBe(1);

    controller.destroy();
    history.replaceState(null, '', '/c/c');
    window.dispatchEvent(new Event(EVENTS.navigation));
    vi.runAllTimers();
    expect(controller.getMetrics().conversationId).toBe('b');
  });

  it('does not cleanup or restore hidden history for same-conversation href/query changes', () => {
    populate();
    const controller = new SessionController(applyModePreset(DEFAULT_CONFIG, 'ultra-lite'));
    controller.start();
    vi.runAllTimers();
    const hiddenBefore = document.querySelectorAll('.csg-balanced-hidden').length;
    expect(hiddenBefore).toBeGreaterThan(0);

    history.replaceState(null, '', '/c/a?model=auto');
    window.dispatchEvent(new Event(EVENTS.navigation));
    vi.runAllTimers();

    expect(controller.getMetrics().cleanupCount).toBe(0);
    expect(controller.getMetrics().spaSwitchCount).toBe(0);
    expect(document.querySelectorAll('.csg-balanced-hidden')).toHaveLength(hiddenBefore);
    controller.destroy();
  });

  it('drops delayed evaluate tasks from an older navigation epoch', () => {
    populate();
    const trace: SessionTraceEvent[] = [];
    const controller = new SessionController(DEFAULT_CONFIG, undefined, (event) => trace.push(event));
    controller.start();

    history.replaceState(null, '', '/c/b');
    window.dispatchEvent(new Event(EVENTS.navigation));
    vi.runAllTimers();

    const evaluates = trace.filter((event) => event.type === 'evaluate');
    expect(evaluates.every((event) => event.conversationId === 'b')).toBe(true);
    expect(controller.getMetrics().conversationId).toBe('b');
    controller.destroy();
  });

  it('does not carry Network Guard measurements across conversation routes', () => {
    const controller = new SessionController(DEFAULT_CONFIG);
    controller.start();
    vi.runAllTimers();

    window.dispatchEvent(new CustomEvent(EVENTS.networkStatus, {
      detail: JSON.stringify({ mode: 'paginated', modified: true, requestedTurns: 50, effectiveTurns: 8 })
    }));
    vi.runAllTimers();
    expect(controller.getMetrics().networkMode).toBe('paginated');
    expect(controller.getMetrics().networkRequestedTurns).toBe(50);

    history.replaceState(null, '', '/c/b');
    window.dispatchEvent(new Event(EVENTS.navigation));
    vi.runAllTimers();

    expect(controller.getMetrics().networkMode).toBe('unknown');
    expect(controller.getMetrics().networkRequestedTurns).toBeNull();
    expect(controller.getMetrics().networkEffectiveTurns).toBeNull();
    controller.destroy();
  });
  it('does not repeatedly evaluate 500-round history for ordinary streaming subtree mutations', async () => {
    document.body.replaceChildren();
    populate(500);
    const trace: SessionTraceEvent[] = [];
    const controller = new SessionController(applyModePreset(DEFAULT_CONFIG, 'ultra-lite'), undefined, (event) => trace.push(event));
    controller.start();
    vi.runAllTimers();
    const before = trace.filter((event) => event.type === 'evaluate').length;
    const last = document.querySelector<HTMLElement>('[data-testid="conversation-turn-499-assistant"] [data-message-author-role]');
    for (let index = 0; index < 40; index += 1) { const span = document.createElement('span'); span.textContent = String(index); last?.appendChild(span); }
    await Promise.resolve();
    vi.runAllTimers();
    const afterStreaming = trace.filter((event) => event.type === 'evaluate').length;
    expect(afterStreaming).toBe(before);

    const main = document.querySelector('main');
    const newTurn = document.createElement('article');
    newTurn.setAttribute('data-testid', 'conversation-turn-new-user');
    const body = document.createElement('div'); body.setAttribute('data-message-author-role', 'user'); newTurn.appendChild(body); main?.appendChild(newTurn);
    await Promise.resolve();
    vi.runAllTimers();
    const afterTopology = trace.filter((event) => event.type === 'evaluate').length;
    expect(afterTopology).toBe(before + 1);
    controller.destroy();
  });

  it('restores hidden visual state only for explicit disable or Temporary Full History', () => {
    populate();
    const ultra = applyModePreset(DEFAULT_CONFIG, 'ultra-lite');
    const controller = new SessionController(ultra);
    controller.start();
    vi.runAllTimers();
    expect(document.querySelectorAll('.csg-balanced-hidden').length).toBeGreaterThan(0);
    controller.updateConfig({ ...ultra, enabled: false });
    expect(document.querySelectorAll('.csg-balanced-hidden')).toHaveLength(0);
    vi.runAllTimers();
    controller.updateConfig(ultra);
    vi.runAllTimers();
    expect(document.querySelectorAll('.csg-balanced-hidden').length).toBeGreaterThan(0);
    controller.updateConfig({ ...ultra, temporaryFullHistory: true });
    expect(document.querySelectorAll('.csg-balanced-hidden')).toHaveLength(0);
    controller.destroy();
  });

});
