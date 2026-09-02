import { describe, expect, it } from 'vitest';
import { buildActivePath, buildVisibleRounds, getVisibleRole, trimLegacyConversation } from '../src/main-world/legacy-adapter';
import type { LegacyConversationData } from '../src/main-world/schema-validator';

function fixture(): LegacyConversationData {
  return {
    root: 'root',
    current_node: 'a3',
    mapping: {
      root: { parent: null, children: ['sys'] },
      sys: { parent: 'root', children: ['u1'], message: { author: { role: 'system' }, content: { content_type: 'text' } } },
      u1: { parent: 'sys', children: ['think1', 'a1-alt'], message: { author: { role: 'user' }, content: { content_type: 'text' } } },
      think1: { parent: 'u1', children: ['tool1'], message: { author: { role: 'assistant' }, recipient: 'all', content: { content_type: 'thoughts' } } },
      tool1: { parent: 'think1', children: ['a1'], message: { author: { role: 'tool' }, content: { content_type: 'tool_result' } } },
      a1: { parent: 'tool1', children: ['u2'], message: { author: { role: 'assistant' }, recipient: 'all', content: { content_type: 'text' } } },
      'a1-alt': { parent: 'u1', children: [], message: { author: { role: 'assistant' }, recipient: 'all', content: { content_type: 'text' } } },
      u2: { parent: 'a1', children: ['hidden2'], message: { author: { role: 'user' }, content: { content_type: 'multimodal_text' } } },
      hidden2: { parent: 'u2', children: ['a2'], message: { author: { role: 'assistant' }, recipient: 'python', content: { content_type: 'text' } } },
      a2: { parent: 'hidden2', children: ['u3'], message: { author: { role: 'assistant' }, recipient: 'all', content: { content_type: 'text' } } },
      u3: { parent: 'a2', children: ['a3'], message: { author: { role: 'user' }, content: { content_type: 'text' } } },
      a3: { parent: 'u3', children: [], message: { author: { role: 'assistant' }, recipient: 'all', content: { content_type: 'text' } } }
    }
  };
}

describe('legacy mapping adapter', () => {
  it('counts user-visible rounds instead of internal thinking/tool nodes', () => {
    const data = fixture();
    const path = buildActivePath(data);
    expect(path).not.toBeNull();
    const rounds = buildVisibleRounds(path ?? [], data.mapping);
    expect(rounds).toHaveLength(3);
    expect(rounds.map((round) => round.visibleNodeIds)).toEqual([
      ['u1', 'a1'],
      ['u2', 'a2'],
      ['u3', 'a3']
    ]);
  });

  it('treats thinking, tool, hidden assistant recipients and hidden metadata as non-round nodes', () => {
    const data = fixture();
    expect(getVisibleRole(data.mapping.think1)).toBeNull();
    expect(getVisibleRole(data.mapping.tool1)).toBeNull();
    expect(getVisibleRole(data.mapping.hidden2)).toBeNull();
    expect(getVisibleRole({ parent: null, message: { author: { role: 'assistant' }, metadata: { is_visually_hidden_from_conversation: true } } })).toBeNull();
  });

  it('uses a shadow-tree cut while preserving the original mapping entries and branches', () => {
    const data = fixture();
    const result = trimLegacyConversation(data, 2);
    expect(result?.modified).toBe(true);
    expect(result?.totalRounds).toBe(3);
    expect(result?.keptRounds).toBe(2);
    expect(result?.data.mapping.root?.children).toEqual(['u2']);
    expect(result?.data.mapping.u2?.parent).toBe('root');
    expect(result?.data.current_node).toBe('a3');
    expect(result?.data.mapping['a1-alt']).toEqual(data.mapping['a1-alt']);
    expect(result?.data.mapping.think1).toEqual(data.mapping.think1);
    expect(Object.keys(result?.data.mapping ?? {})).toHaveLength(Object.keys(data.mapping).length);
  });

  it('returns unchanged data when no trim is needed and null for broken paths', () => {
    const data = fixture();
    expect(trimLegacyConversation(data, 8)?.modified).toBe(false);

    const broken = fixture();
    broken.mapping.a3 = { ...broken.mapping.a3!, parent: 'missing' };
    expect(trimLegacyConversation(broken, 2)).toBeNull();
  });
});
