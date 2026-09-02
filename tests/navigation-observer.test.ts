import { describe, expect, it } from 'vitest';
import { EVENTS } from '../src/shared/events';
import { extractConversationId, NavigationObserver } from '../src/content/navigation-observer';

describe('SPA route detection', () => {
  it('extracts conversation ids from ChatGPT routes including branch suffixes', () => {
    expect(extractConversationId('/c/abc')).toBe('abc');
    expect(extractConversationId('/c/abc/branch')).toBe('abc');
    expect(extractConversationId('/')).toBeNull();
  });

  it('does not duplicate listeners when started twice and removes them on destroy', () => {
    history.replaceState(null, '', '/c/a');
    const seen: Array<string | null> = [];
    const observer = new NavigationObserver((id) => seen.push(id));
    observer.start();
    observer.start();
    expect(seen).toEqual(['a']);

    history.replaceState(null, '', '/c/b');
    window.dispatchEvent(new Event(EVENTS.navigation));
    expect(seen).toEqual(['a', 'b']);

    observer.destroy();
    history.replaceState(null, '', '/c/c');
    window.dispatchEvent(new Event(EVENTS.navigation));
    expect(seen).toEqual(['a', 'b']);
  });
});
