import {
  evidenceContainsSensitiveMaterial,
  sanitizeForEvidence,
  sanitizeNetworkObservation,
  sanitizeUrl
} from '../../scripts/smoke/sanitizer.mjs';

const SALT = 'unit-test-salt';

describe('smoke evidence sanitizer', () => {
  it('never outputs authorization, cookie, request body or response body fields', () => {
    const sanitized = sanitizeForEvidence({
      Authorization: 'Bearer secret',
      Cookie: 'session=secret',
      requestBody: 'private prompt',
      responseBody: 'private answer',
      status: 200
    }, SALT);
    expect(JSON.stringify(sanitized)).toBe('{"status":200}');
  });

  it('never outputs conversation prompt, answer, content, html or text fields', () => {
    const sanitized = sanitizeForEvidence({
      prompt: 'private',
      answer: 'private',
      textContent: 'private',
      innerHTML: '<p>private</p>',
      content: 'private',
      count: 3
    }, SALT);
    expect(sanitized).toEqual({ count: 3 });
  });

  it('hashes conversation ids and removes them from paths', () => {
    const value = sanitizeForEvidence({
      conversationId: 'fake-conversation-12345678',
      pathname: '/backend-api/conversation/fake-conversation-12345678'
    }, SALT) as { conversationIdHash?: string; pathname?: string };
    expect(value.conversationIdHash).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(value)).not.toContain('fake-conversation-12345678');
  });

  it('records only pathname and query-key names for network observations', () => {
    const record = sanitizeNetworkObservation({
      timestamp: '2026-09-03T00:00:00.000Z',
      method: 'GET',
      status: 200,
      url: 'https://chatgpt.com/backend-api/conversation/fake-conversation-12345678?before=cursor-secret&foo=bar',
      durationMs: 12
    }, SALT);
    expect(record.pathname).toBe('/backend-api/conversation/:conversation');
    expect(record.queryKeys).toEqual(['before', 'foo']);
    expect(record.requestClassification).toBe('older-page');
    expect(JSON.stringify(record)).not.toContain('cursor-secret');
    expect(JSON.stringify(record)).not.toContain('bar');
  });

  it('marks raw sensitive evidence as unsafe', () => {
    expect(evidenceContainsSensitiveMaterial('Authorization: Bearer secret')).toBe(true);
    expect(evidenceContainsSensitiveMaterial({ status: 200, pathname: '/backend-api/conversation' })).toBe(false);
  });

  it('does not preserve query values when sanitizing URLs', () => {
    const sanitized = sanitizeUrl('https://chatgpt.com/backend-api/conversations?offset=0&limit=28', SALT);
    expect(sanitized.queryKeys).toEqual(['limit', 'offset']);
    expect(JSON.stringify(sanitized)).not.toContain('28');
  });
});
