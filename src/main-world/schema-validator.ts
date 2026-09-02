export interface ConversationMessage {
  id?: string;
  author?: { role?: string };
  recipient?: string;
  content?: { content_type?: string; parts?: unknown[] };
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ConversationNode {
  parent: string | null;
  children?: string[];
  message?: ConversationMessage;
}

export interface LegacyConversationData {
  mapping: Record<string, ConversationNode>;
  current_node: string;
  root?: string;
  [key: string]: unknown;
}

export interface PageInfo {
  start_cursor?: string | null;
  end_cursor?: string | null;
  has_previous_page?: boolean;
  has_next_page?: boolean;
  [key: string]: unknown;
}

export interface PaginatedConversationData {
  messages: ConversationMessage[];
  page_info: PageInfo;
  current_node?: string;
  conversation_id?: string;
  [key: string]: unknown;
}

export type ConversationSchema =
  | { kind: 'legacy'; data: LegacyConversationData }
  | { kind: 'paginated'; data: PaginatedConversationData }
  | { kind: 'unknown'; data: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConversationNode(value: unknown): value is ConversationNode {
  if (!isRecord(value)) return false;
  const parent = value.parent;
  return (typeof parent === 'string' || parent === null) &&
    (value.children === undefined || (Array.isArray(value.children) && value.children.every((entry) => typeof entry === 'string')));
}

function validOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function validOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function isPageInfo(value: unknown): value is PageInfo {
  if (!isRecord(value)) return false;
  return validOptionalString(value.start_cursor) &&
    validOptionalString(value.end_cursor) &&
    validOptionalBoolean(value.has_previous_page) &&
    validOptionalBoolean(value.has_next_page);
}

function isPaginatedMessage(value: unknown): value is ConversationMessage {
  if (!isRecord(value)) return false;
  if (value.id !== undefined && typeof value.id !== 'string') return false;
  if (value.author !== undefined && !isRecord(value.author)) return false;
  if (value.content !== undefined && !isRecord(value.content)) return false;
  if (value.metadata !== undefined && !isRecord(value.metadata)) return false;
  return true;
}

export function detectConversationSchema(value: unknown): ConversationSchema {
  if (!isRecord(value)) return { kind: 'unknown', data: value };

  if (isRecord(value.mapping) && typeof value.current_node === 'string') {
    const currentNode = value.mapping[value.current_node];
    if (currentNode && isConversationNode(currentNode)) {
      return { kind: 'legacy', data: value as LegacyConversationData };
    }
  }

  if (Array.isArray(value.messages) && value.messages.every(isPaginatedMessage) && isPageInfo(value.page_info)) {
    if (value.current_node !== undefined && typeof value.current_node !== 'string') {
      return { kind: 'unknown', data: value };
    }
    return { kind: 'paginated', data: value as unknown as PaginatedConversationData };
  }

  return { kind: 'unknown', data: value };
}
