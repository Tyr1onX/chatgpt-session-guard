import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/shared/config';
import { EVENTS } from '../src/shared/events';
import { SessionController } from '../src/content/session-controller';

describe('Session Switch Guard lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    history.replaceState(null, '', '/c/a');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cleans the previous conversation scope before initializing the next route', () => {
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
});
