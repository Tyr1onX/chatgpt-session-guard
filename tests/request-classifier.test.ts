import { describe, expect, it } from 'vitest';
import { classifyRequest } from '../src/main-world/request-classifier';

describe('request classifier', () => {
  it('allows only exact same-origin GET conversation history paths', () => {
    const current = location.origin;
    expect(classifyRequest(`${current}/backend-api/conversation/abc`).kind).toBe('legacy-conversation-history');
    expect(classifyRequest(`${current}/backend-api/shared_conversation/abc`).kind).toBe('shared-conversation-history');
    expect(classifyRequest(`${current}/backend-api/conversations/abc?include_has_versions=true&num_turns=10`).kind)
      .toBe('paginated-conversation-history');
    expect(classifyRequest(`${current}/backend-api/conversations/abc/messages?before=cursor&num_turns=100`).kind)
      .toBe('paginated-conversation-page');
  });

  it('rejects POST, streaming, textdocs and unrelated backend requests', () => {
    const current = location.origin;
    expect(classifyRequest(`${current}/backend-api/conversation`, { method: 'POST' }).kind).toBe('other');
    expect(classifyRequest(`${current}/backend-api/conversation/abc`, { method: 'POST' }).kind).toBe('other');
    expect(classifyRequest(`${current}/backend-api/conversations/abc`, { method: 'POST' }).kind).toBe('other');
    expect(classifyRequest(`${current}/backend-api/conversation/abc/stream_status`).kind).toBe('other');
    expect(classifyRequest(`${current}/backend-api/conversation/abc/textdocs`).kind).toBe('other');
    expect(classifyRequest(`${current}/backend-api/f/conversation`).kind).toBe('other');
    expect(classifyRequest(`${current}/backend-api/files/upload`).kind).toBe('other');
    expect(classifyRequest(`${current}/backend-api/settings`).kind).toBe('other');
  });

  it('rejects cross-origin lookalikes', () => {
    expect(classifyRequest('https://example.com/backend-api/conversations/abc?num_turns=10').kind).toBe('other');
  });
});
