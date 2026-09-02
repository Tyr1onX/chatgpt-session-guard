import { describe, expect, it } from 'vitest';
import { detectConversationSchema } from '../src/main-world/schema-validator';

describe('conversation schema validator', () => {
  it('recognizes a legacy mapping response', () => {
    const result = detectConversationSchema({
      mapping: { root: { parent: null, children: ['a'] }, a: { parent: 'root', children: [] } },
      current_node: 'a',
      root: 'root'
    });
    expect(result.kind).toBe('legacy');
  });

  it('recognizes the Aug 2026 paginated messages/page_info response', () => {
    const result = detectConversationSchema({
      conversation_id: 'abc',
      current_node: 'a2',
      messages: [
        { id: 'u1', author: { role: 'user' }, content: { content_type: 'text', parts: ['hello'] } },
        { id: 'a2', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['hi'] } }
      ],
      page_info: {
        start_cursor: 'older',
        end_cursor: 'newer',
        has_previous_page: true,
        has_next_page: false
      }
    });
    expect(result.kind).toBe('paginated');
  });

  it('fails open on malformed or unknown shapes', () => {
    expect(detectConversationSchema({ mapping: {}, current_node: 'missing' }).kind).toBe('unknown');
    expect(detectConversationSchema({ messages: [], page_info: { has_previous_page: 'yes' } }).kind).toBe('unknown');
    expect(detectConversationSchema({ items: [], cursor: 'legacy-list-envelope' }).kind).toBe('unknown');
    expect(detectConversationSchema('nope').kind).toBe('unknown');
  });
});
