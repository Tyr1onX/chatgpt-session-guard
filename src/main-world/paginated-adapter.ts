import { networkHistoryTarget, type GuardConfig } from '../shared/config';
import type { ClassifiedRequest } from './request-classifier';
import type { PaginatedConversationData } from './schema-validator';

export interface PaginatedRequestRewrite {
  args: Parameters<typeof fetch>;
  modified: boolean;
  requestedTurns: number | null;
  effectiveTurns: number | null;
}

export interface PaginatedAdaptResult {
  data: PaginatedConversationData;
  modified: false;
}

function rewriteInputUrl(input: RequestInfo | URL, url: URL): RequestInfo | URL {
  if (input instanceof Request) return new Request(url.toString(), input);
  if (input instanceof URL) return url;
  return url.toString();
}

function conversationIdFromUrl(url: URL): string | null {
  const match = url.pathname.match(/^\/backend-api\/conversations\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * Current ChatGPT Web requests the newest page from
 * /backend-api/conversations/{id}?num_turns=N and older pages from
 * /backend-api/conversations/{id}/messages?before=<cursor>.
 *
 * We only lower an already-present, valid num_turns on the initial-page request.
 * The target follows the user's visible history setting but never goes below
 * MIN_SAFE_NETWORK_TURNS until low-value semantics are proven safe in real
 * tool/thinking/branch conversations. We never synthesize cursors or increase
 * what ChatGPT asked for. Unknown query shapes fail open unchanged.
 */
export function rewritePaginatedRequest(
  classification: ClassifiedRequest,
  config: GuardConfig,
  args: Parameters<typeof fetch>
): PaginatedRequestRewrite {
  if (classification.kind !== 'paginated-conversation-history') {
    return { args, modified: false, requestedTurns: null, effectiveTurns: null };
  }

  const raw = classification.url.searchParams.get('num_turns');
  if (raw === null || !/^\d+$/.test(raw)) {
    return { args, modified: false, requestedTurns: null, effectiveTurns: null };
  }

  const requestedTurns = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(requestedTurns) || requestedTurns < 1 || requestedTurns > 100) {
    return { args, modified: false, requestedTurns, effectiveTurns: null };
  }

  const conversationId = conversationIdFromUrl(classification.url);
  const target = networkHistoryTarget(config, conversationId);
  const effectiveTurns = Math.min(requestedTurns, target);
  if (effectiveTurns === requestedTurns) {
    return { args, modified: false, requestedTurns, effectiveTurns };
  }

  const rewrittenUrl = new URL(classification.url.toString());
  rewrittenUrl.searchParams.set('num_turns', String(effectiveTurns));
  const rewrittenInput = rewriteInputUrl(args[0], rewrittenUrl);
  return {
    args: [rewrittenInput, args[1]],
    modified: true,
    requestedTurns,
    effectiveTurns
  };
}


export function shouldSuppressOlderHistory(classification: ClassifiedRequest, config: GuardConfig): boolean {
  if (classification.kind !== 'paginated-conversation-page') return false;
  if (config.autoLoadHistory || config.temporaryFullHistory) return false;
  const match = classification.url.pathname.match(/^\/backend-api\/conversations\/([^/]+)\/messages$/);
  const conversationId = match?.[1] ? decodeURIComponent(match[1]) : null;
  const manualExpansionActive = Boolean(
    conversationId &&
    config.historyExpansionConversationId === conversationId &&
    config.historyExpansion > 0
  );
  return !manualExpansionActive;
}

export function suppressOlderHistoryPage(data: PaginatedConversationData): PaginatedConversationData {
  return {
    ...data,
    messages: [],
    page_info: {
      ...data.page_info,
      has_previous_page: false
    }
  };
}

/** The paginated response is validated but otherwise left intact. */
export function adaptPaginatedConversation(data: PaginatedConversationData): PaginatedAdaptResult {
  return { data, modified: false };
}
