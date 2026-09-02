import type { ConversationNode, LegacyConversationData } from './schema-validator';

export type VisibleRole = 'user' | 'assistant';

export interface VisibleRound {
  startPathIndex: number;
  endPathIndex: number;
  visibleNodeIds: string[];
}

export interface LegacyTrimResult {
  data: LegacyConversationData;
  totalRounds: number;
  keptRounds: number;
  modified: boolean;
}

const HIDDEN_CONTENT_TYPES = new Set([
  'thoughts',
  'reasoning',
  'reasoning_recap',
  'computer_output',
  'tool_result',
  'execution_output',
  'model_editable_context'
]);

function metadataHidesMessage(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) return false;
  return metadata.is_visually_hidden_from_conversation === true ||
    metadata.is_hidden === true ||
    metadata.is_internal === true;
}

export function getVisibleRole(node: ConversationNode | undefined): VisibleRole | null {
  const message = node?.message;
  const role = message?.author?.role;
  if (role !== 'user' && role !== 'assistant') return null;
  if (metadataHidesMessage(message?.metadata)) return null;

  const contentType = message?.content?.content_type;
  if (contentType && HIDDEN_CONTENT_TYPES.has(contentType)) return null;

  if (role === 'assistant' && message?.recipient && message.recipient !== 'all') return null;
  return role;
}

export function buildActivePath(data: LegacyConversationData): string[] | null {
  if (!data.mapping[data.current_node]) return null;

  const reversed: string[] = [];
  const visited = new Set<string>();
  let cursor: string | null = data.current_node;

  while (cursor) {
    if (visited.has(cursor)) return null;
    const node: ConversationNode | undefined = data.mapping[cursor];
    if (!node) return null;
    visited.add(cursor);
    reversed.push(cursor);
    cursor = node.parent;
  }

  return reversed.reverse();
}

export function buildVisibleRounds(path: string[], mapping: Record<string, ConversationNode>): VisibleRound[] {
  const rounds: VisibleRound[] = [];
  let current: VisibleRound | null = null;
  let lastVisibleRole: VisibleRole | null = null;

  for (let index = 0; index < path.length; index += 1) {
    const nodeId = path[index];
    if (!nodeId) continue;
    const role = getVisibleRole(mapping[nodeId]);
    if (!role) continue;

    const startsRound =
      current === null ||
      role === 'user' ||
      (role === 'assistant' && lastVisibleRole === 'assistant' && current.visibleNodeIds.length === 0);

    if (startsRound) {
      current = {
        startPathIndex: index,
        endPathIndex: index,
        visibleNodeIds: [nodeId]
      };
      rounds.push(current);
    } else if (current) {
      current.endPathIndex = index;
      current.visibleNodeIds.push(nodeId);
    }

    lastVisibleRole = role;
  }

  return rounds;
}

function resolveRootId(data: LegacyConversationData, path: string[]): string | null {
  if (typeof data.root === 'string' && data.mapping[data.root]) return data.root;
  const first = path[0];
  return first && data.mapping[first] ? first : null;
}

export function trimLegacyConversation(data: LegacyConversationData, keepRounds: number): LegacyTrimResult | null {
  const path = buildActivePath(data);
  if (!path || path.length === 0) return null;

  const rounds = buildVisibleRounds(path, data.mapping);
  const effectiveKeep = Math.max(1, Math.floor(keepRounds));
  if (rounds.length <= effectiveKeep) {
    return { data, totalRounds: rounds.length, keptRounds: rounds.length, modified: false };
  }

  const firstKeptRound = rounds[rounds.length - effectiveKeep];
  if (!firstKeptRound) return null;
  const boundaryId = path[firstKeptRound.startPathIndex];
  const rootId = resolveRootId(data, path);
  if (!boundaryId || !rootId || boundaryId === rootId) return null;

  const rootNode = data.mapping[rootId];
  const boundaryNode = data.mapping[boundaryId];
  if (!rootNode || !boundaryNode) return null;

  // Shadow-tree strategy: preserve the entire mapping object and all hidden/tool/branch
  // nodes. Only change the display-reachable active path at the root/boundary edge.
  // This avoids destructive mapping reconstruction while keeping old history server-side.
  const mapping = { ...data.mapping };
  mapping[rootId] = { ...rootNode, parent: null, children: [boundaryId] };
  mapping[boundaryId] = { ...boundaryNode, parent: rootId };

  return {
    data: { ...data, mapping, root: rootId },
    totalRounds: rounds.length,
    keptRounds: effectiveKeep,
    modified: true
  };
}
