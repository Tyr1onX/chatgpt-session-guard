import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, applyModePreset, normalizeConfig } from '../src/shared/config';
import {
  rewritePaginatedRequest,
  shouldSuppressOlderHistory,
  suppressOlderHistoryPage
} from '../src/main-world/paginated-adapter';
import { classifyRequest } from '../src/main-world/request-classifier';

describe('Aug 2026 paginated conversation adapter', () => {
  it('lowers an existing valid num_turns without touching other query parameters', () => {
    const url = `${location.origin}/backend-api/conversations/abc?include_has_versions=true&num_turns=100`;
    const classification = classifyRequest(url);
    const result = rewritePaginatedRequest(classification, DEFAULT_CONFIG, [url]);
    expect(result.modified).toBe(true);
    expect(result.requestedTurns).toBe(100);
    expect(result.effectiveTurns).toBe(8);
    const rewritten = new URL(String(result.args[0]));
    expect(rewritten.searchParams.get('num_turns')).toBe('8');
    expect(rewritten.searchParams.get('include_has_versions')).toBe('true');
  });

  it('never increases a smaller request and fails open when num_turns is absent or invalid', () => {
    const small = `${location.origin}/backend-api/conversations/abc?num_turns=4`;
    expect(rewritePaginatedRequest(classifyRequest(small), DEFAULT_CONFIG, [small]).modified).toBe(false);

    const missing = `${location.origin}/backend-api/conversations/abc?include_has_versions=true`;
    expect(rewritePaginatedRequest(classifyRequest(missing), DEFAULT_CONFIG, [missing]).modified).toBe(false);

    const invalid = `${location.origin}/backend-api/conversations/abc?num_turns=500`;
    expect(rewritePaginatedRequest(classifyRequest(invalid), DEFAULT_CONFIG, [invalid]).modified).toBe(false);
  });

  it('maps Ultra Lite and 1-message history to the conservative network floor', () => {
    const url = `${location.origin}/backend-api/conversations/abc?num_turns=10`;
    const ultra = applyModePreset(DEFAULT_CONFIG, 'ultra-lite');
    expect(rewritePaginatedRequest(classifyRequest(url), ultra, [url]).effectiveTurns).toBe(4);

    const oneMessage = normalizeConfig({ historyUnit: 'message', historyCount: 1 });
    expect(rewritePaginatedRequest(classifyRequest(url), oneMessage, [url]).effectiveTurns).toBe(4);
  });

  it('uses temporary expansion only for the matching conversation', () => {
    const config = normalizeConfig({
      historyUnit: 'round',
      historyCount: 1,
      historyExpansion: 10,
      historyExpansionConversationId: 'abc'
    });
    const abc = `${location.origin}/backend-api/conversations/abc?num_turns=10`;
    const other = `${location.origin}/backend-api/conversations/other?num_turns=10`;
    expect(rewritePaginatedRequest(classifyRequest(abc), config, [abc]).effectiveTurns).toBe(10);
    expect(rewritePaginatedRequest(classifyRequest(other), config, [other]).effectiveTurns).toBe(4);
  });

  it('never rewrites cursor-based older-page requests at the URL layer', () => {
    const page = `${location.origin}/backend-api/conversations/abc/messages?before=cursor&include_has_versions=true&num_turns=100`;
    const result = rewritePaginatedRequest(classifyRequest(page), DEFAULT_CONFIG, [page]);
    expect(result.modified).toBe(false);
    expect(String(result.args[0])).toBe(page);
  });

  it('suppresses validated automatic older-page content when auto-load is off', () => {
    const page = `${location.origin}/backend-api/conversations/abc/messages?before=cursor&num_turns=100`;
    const classification = classifyRequest(page);
    expect(shouldSuppressOlderHistory(classification, DEFAULT_CONFIG)).toBe(true);
    const suppressed = suppressOlderHistoryPage({
      messages: [{ id: 'old-message' }],
      page_info: { has_previous_page: true, start_cursor: 'older' }
    });
    expect(suppressed.messages).toEqual([]);
    expect(suppressed.page_info.has_previous_page).toBe(false);
  });

  it('allows older-page content during a matching manual expansion', () => {
    const page = `${location.origin}/backend-api/conversations/abc/messages?before=cursor&num_turns=100`;
    const config = normalizeConfig({
      ...DEFAULT_CONFIG,
      historyExpansion: 10,
      historyExpansionConversationId: 'abc'
    });
    expect(shouldSuppressOlderHistory(classifyRequest(page), config)).toBe(false);
  });

  it('preserves Request headers and credentials when rewriting a Request object', () => {
    const request = new Request(
      `${location.origin}/backend-api/conversations/abc?num_turns=10`,
      { headers: { 'x-test': 'yes' }, credentials: 'include' }
    );
    const result = rewritePaginatedRequest(classifyRequest(request), DEFAULT_CONFIG, [request]);
    expect(result.modified).toBe(true);
    const rewritten = result.args[0];
    expect(rewritten).toBeInstanceOf(Request);
    expect((rewritten as Request).headers.get('x-test')).toBe('yes');
    expect((rewritten as Request).credentials).toBe('include');
  });
});
