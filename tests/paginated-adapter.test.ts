import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, applyModePreset, normalizeConfig } from '../src/shared/config';
import {
  isKnownOlderPageRequestShape,
  rewritePaginatedRequest,
  shouldPreflightSuppressOlderHistory,
  shouldSuppressOlderHistory,
  suppressOlderHistoryPage,
  syntheticEmptyOlderHistoryPage
} from '../src/main-world/paginated-adapter';
import { classifyRequest } from '../src/main-world/request-classifier';
import { detectConversationSchema } from '../src/main-world/schema-validator';

describe('paginated conversation adapter', () => {
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

  it('keeps Ultra Lite initial history at the conservative network floor 10 → 4', () => {
    const url = `${location.origin}/backend-api/conversations/abc?num_turns=10`;
    const ultra = applyModePreset(DEFAULT_CONFIG, 'ultra-lite');
    expect(rewritePaginatedRequest(classifyRequest(url), ultra, [url]).effectiveTurns).toBe(4);

    const oneMessage = normalizeConfig({ historyUnit: 'message', historyCount: 1 });
    expect(rewritePaginatedRequest(classifyRequest(url), oneMessage, [url]).effectiveTurns).toBe(4);
  });

  it('uses temporary expansion only for the matching conversation', () => {
    const config = normalizeConfig({
      historyUnit: 'round', historyCount: 1, historyExpansion: 10, historyExpansionConversationId: 'abc'
    });
    const abc = `${location.origin}/backend-api/conversations/abc?num_turns=10`;
    const other = `${location.origin}/backend-api/conversations/other?num_turns=10`;
    expect(rewritePaginatedRequest(classifyRequest(abc), config, [abc]).effectiveTurns).toBe(10);
    expect(rewritePaginatedRequest(classifyRequest(other), config, [other]).effectiveTurns).toBe(4);
  });

  it('recognizes only the exact known older-page query shape', () => {
    const known = classifyRequest(`${location.origin}/backend-api/conversations/abc/messages?before=cursor&include_has_versions=true&num_turns=100`);
    const unknownQuery = classifyRequest(`${location.origin}/backend-api/conversations/abc/messages?before=cursor&future_flag=1`);
    const missingCursor = classifyRequest(`${location.origin}/backend-api/conversations/abc/messages?num_turns=100`);
    expect(isKnownOlderPageRequestShape(known)).toBe(true);
    expect(isKnownOlderPageRequestShape(unknownQuery)).toBe(false);
    expect(isKnownOlderPageRequestShape(missingCursor)).toBe(false);
  });

  it('preflight suppresses known manual-only older pages', () => {
    const page = `${location.origin}/backend-api/conversations/abc/messages?before=cursor&num_turns=100`;
    const classification = classifyRequest(page);
    expect(shouldPreflightSuppressOlderHistory(classification, DEFAULT_CONFIG)).toBe(true);
    expect(shouldSuppressOlderHistory(classification, DEFAULT_CONFIG)).toBe(true);
  });

  it('does not preflight suppress when manual expansion is active', () => {
    const page = `${location.origin}/backend-api/conversations/abc/messages?before=cursor&num_turns=100`;
    const config = normalizeConfig({ ...DEFAULT_CONFIG, historyExpansion: 10, historyExpansionConversationId: 'abc' });
    expect(shouldPreflightSuppressOlderHistory(classifyRequest(page), config)).toBe(false);
  });

  it('does not preflight suppress Temporary Full History or auto-load', () => {
    const page = `${location.origin}/backend-api/conversations/abc/messages?before=cursor&num_turns=100`;
    expect(shouldPreflightSuppressOlderHistory(classifyRequest(page), normalizeConfig({ ...DEFAULT_CONFIG, temporaryFullHistory: true }))).toBe(false);
    expect(shouldPreflightSuppressOlderHistory(classifyRequest(page), normalizeConfig({ ...DEFAULT_CONFIG, autoLoadHistory: true }))).toBe(false);
  });

  it('fails open for unknown older-page query shapes', () => {
    const page = `${location.origin}/backend-api/conversations/abc/messages?before=cursor&new_internal_flag=1`;
    expect(shouldPreflightSuppressOlderHistory(classifyRequest(page), DEFAULT_CONFIG)).toBe(false);
    expect(shouldSuppressOlderHistory(classifyRequest(page), DEFAULT_CONFIG)).toBe(false);
  });

  it('builds a synthetic empty page that passes the same strict schema validator', () => {
    const data = syntheticEmptyOlderHistoryPage();
    expect(detectConversationSchema(data).kind).toBe('paginated');
    expect(data.messages).toEqual([]);
    expect(data.page_info).toEqual({
      start_cursor: null,
      end_cursor: null,
      has_previous_page: false,
      has_next_page: false
    });
  });

  it('post-response suppression remains safe for validated known pages', () => {
    const suppressed = suppressOlderHistoryPage({
      messages: [{ id: 'old-message' }],
      page_info: { has_previous_page: true, start_cursor: 'older' }
    });
    expect(suppressed.messages).toEqual([]);
    expect(suppressed.page_info.has_previous_page).toBe(false);
  });

  it('preserves Request headers and credentials when rewriting a Request object', () => {
    const request = new Request(`${location.origin}/backend-api/conversations/abc?num_turns=10`, {
      headers: { 'x-test': 'yes' }, credentials: 'include'
    });
    const result = rewritePaginatedRequest(classifyRequest(request), DEFAULT_CONFIG, [request]);
    expect(result.modified).toBe(true);
    const rewritten = result.args[0];
    expect(rewritten).toBeInstanceOf(Request);
    expect((rewritten as Request).headers.get('x-test')).toBe('yes');
    expect((rewritten as Request).credentials).toBe('include');
  });
});
