import { beforeEach, describe, expect, it } from 'vitest';
import {
  EXPERIMENTAL_BENCHMARK_MODES,
  STANDARD_BENCHMARK_MODES
} from '../src/shared/benchmark';
import { LONG_STRESS_SETTINGS } from '../src/shared/long-stress';
import { collectSidebarConversationIds } from '../src/content/benchmark-runner';

describe('benchmark sidebar discovery', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    history.replaceState({}, '', '/c/current-conversation');
  });

  it('collects unique real /c/{conversationId} links without reading message content', () => {
    document.body.innerHTML = `
      <nav>
        <a href="/">Home</a>
        <a href="/c/conversation-a">A</a>
        <a href="/c/conversation-b?x=1">B</a>
        <a href="https://chatgpt.com/c/conversation-c">C</a>
        <a href="/c/conversation-a">Duplicate A</a>
        <a href="/g/gpt-id">GPT</a>
        <a href="/c/conversation-d">D</a>
        <a href="/c/conversation-e">E</a>
        <a href="/c/conversation-f">F</a>
      </nav>
      <main>private chat text that must never be inspected <a href="/c/conversation-from-message">message link</a></main>
    `;

    expect(collectSidebarConversationIds(document, 5)).toEqual([
      'conversation-a',
      'conversation-b',
      'conversation-c',
      'conversation-d',
      'conversation-e'
    ]);
  });

  it('returns fewer than five when the visible sidebar does not expose enough conversations', () => {
    document.body.innerHTML = '<nav><a href="/c/a-long-enough-id">A</a><a href="/c/b-long-enough-id">B</a></nav>';
    expect(collectSidebarConversationIds(document, 5)).toHaveLength(2);
  });

  it('keeps Aggressive out of Standard Validation', () => {
    expect(STANDARD_BENCHMARK_MODES).toEqual(['control', 'balanced', 'ultra-lite']);
    expect(EXPERIMENTAL_BENCHMARK_MODES).toEqual(['aggressive']);
  });

  it('defines the long-conversation stress sequence from 8 rounds down to 1 message', () => {
    expect(LONG_STRESS_SETTINGS.map((setting) => setting.label)).toEqual([
      '8 rounds',
      '4 rounds',
      '2 rounds',
      '1 round',
      '1 message'
    ]);
  });
});
