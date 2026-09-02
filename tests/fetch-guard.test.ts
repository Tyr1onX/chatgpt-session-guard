import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, applyModePreset, normalizeConfig } from '../src/shared/config';
import { createGuardedFetch, type NetworkTraceEvent } from '../src/main-world/fetch-guard';
import { detectConversationSchema } from '../src/main-world/schema-validator';

function paginatedResponse(messages = [{ id: 'old' }]): Response {
  return new Response(JSON.stringify({
    messages,
    page_info: {
      start_cursor: 'start',
      end_cursor: 'end',
      has_previous_page: true,
      has_next_page: false
    }
  }), { status: 200, headers: { 'content-type': 'application/json', 'content-length': '1234' } });
}

describe('fetch guard preflight history suppression', () => {
  it('returns a validated synthetic empty older page without calling nativeFetch', async () => {
    const nativeFetch = vi.fn(async () => paginatedResponse()) as unknown as typeof fetch;
    const statuses: unknown[] = [];
    const traces: NetworkTraceEvent[] = [];
    const guard = createGuardedFetch(
      nativeFetch,
      async () => applyModePreset(DEFAULT_CONFIG, 'ultra-lite'),
      (status) => statuses.push(status),
      (event) => traces.push(event)
    );
    const url = `${location.origin}/backend-api/conversations/abc/messages?before=cursor&include_has_versions=true&num_turns=100`;
    const response = await guard(url);
    expect(nativeFetch).not.toHaveBeenCalled();
    const data = await response.json();
    expect(detectConversationSchema(data).kind).toBe('paginated');
    expect(data.messages).toEqual([]);
    expect(data.page_info.has_previous_page).toBe(false);
    expect(traces.at(-1)?.preflightSuppressed).toBe(true);
    expect(statuses).toHaveLength(1);
  });

  it('calls nativeFetch when matching manual expansion is active', async () => {
    const nativeFetch = vi.fn(async () => paginatedResponse()) as unknown as typeof fetch;
    const config = normalizeConfig({
      ...applyModePreset(DEFAULT_CONFIG, 'ultra-lite'),
      historyExpansion: 10,
      historyExpansionConversationId: 'abc'
    });
    const guard = createGuardedFetch(nativeFetch, async () => config, () => undefined, () => undefined);
    const url = `${location.origin}/backend-api/conversations/abc/messages?before=cursor&num_turns=100`;
    const response = await guard(url);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    const data = await response.json();
    expect(data.messages).toHaveLength(1);
  });

  it('calls nativeFetch during Temporary Full History', async () => {
    const nativeFetch = vi.fn(async () => paginatedResponse()) as unknown as typeof fetch;
    const config = normalizeConfig({ ...DEFAULT_CONFIG, temporaryFullHistory: true });
    const guard = createGuardedFetch(nativeFetch, async () => config, () => undefined, () => undefined);
    const url = `${location.origin}/backend-api/conversations/abc/messages?before=cursor&num_turns=100`;
    await guard(url);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });

  it('fails open to nativeFetch for an unknown older-page query shape', async () => {
    const nativeFetch = vi.fn(async () => paginatedResponse()) as unknown as typeof fetch;
    const guard = createGuardedFetch(nativeFetch, async () => DEFAULT_CONFIG, () => undefined, () => undefined);
    const url = `${location.origin}/backend-api/conversations/abc/messages?before=cursor&new_internal_flag=1`;
    const response = await guard(url);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    const data = await response.json();
    expect(data.messages).toHaveLength(1);
  });

  it('still rewrites the initial Ultra Lite request from 10 to 4', async () => {
    const nativeFetch = vi.fn(async () => paginatedResponse([])) as unknown as typeof fetch;
    const guard = createGuardedFetch(
      nativeFetch,
      async () => applyModePreset(DEFAULT_CONFIG, 'ultra-lite'),
      () => undefined,
      () => undefined
    );
    const url = `${location.origin}/backend-api/conversations/abc?include_has_versions=true&num_turns=10`;
    await guard(url);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    const called = String(vi.mocked(nativeFetch).mock.calls[0]?.[0]);
    expect(new URL(called).searchParams.get('num_turns')).toBe('4');
  });

  it('records only sanitized pathname/query keys for unclassified history-like GETs', async () => {
    const traces: NetworkTraceEvent[] = [];
    const nativeFetch = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    const guard = createGuardedFetch(nativeFetch, async () => DEFAULT_CONFIG, () => undefined, (event) => traces.push(event));
    await guard(`${location.origin}/backend-api/new_conversation_history?cursor=secret&token=private`);
    expect(traces).toHaveLength(1);
    expect(traces[0]?.type).toBe('unclassified-history-like');
    expect(traces[0]?.pathname).toBe('/backend-api/new_conversation_history');
    expect(traces[0]?.queryKeys).toEqual(['cursor', 'token']);
    expect(JSON.stringify(traces[0])).not.toContain('secret');
    expect(JSON.stringify(traces[0])).not.toContain('private');
  });
});
