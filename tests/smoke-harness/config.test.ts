import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadSmokeConfig, validateSmokeConfig } from '../../scripts/smoke/config.mjs';

const FAKE_LONG_ID = 'fake-long-conversation-0001';
const FAKE_SWITCH_ID = 'fake-switch-conversation-0002';

describe('smoke local config', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'csg-smoke-config-'));
    await mkdir(path.join(root, '.csg-smoke'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('gives a clear setup hint when config is missing', async () => {
    await expect(loadSmokeConfig(root)).rejects.toThrow('run npm run smoke:setup first');
  });

  it('fails safely on malformed JSON', async () => {
    await writeFile(path.join(root, '.csg-smoke', 'config.json'), '{oops', 'utf8');
    await expect(loadSmokeConfig(root)).rejects.toThrow('MALFORMED_SMOKE_CONFIG');
  });

  it('fails safely when the long conversation id is missing', () => {
    expect(validateSmokeConfig({ schemaVersion: 1, switchConversationIds: [] })).toEqual({
      ok: false,
      error: 'LONG_CONVERSATION_ID_MISSING_OR_INVALID'
    });
  });

  it('accepts only local fake ids and removes duplicates', () => {
    const result = validateSmokeConfig({
      schemaVersion: 1,
      longConversationId: FAKE_LONG_ID,
      switchConversationIds: [FAKE_SWITCH_ID, FAKE_SWITCH_ID, FAKE_LONG_ID]
    });
    expect(result.ok).toBe(true);
    if (!result.config) throw new Error('expected validated config');
    expect(result.config.longConversationId).toBe(FAKE_LONG_ID);
    expect(result.config.switchConversationIds).toEqual([FAKE_SWITCH_ID]);
  });

  it('does not require any committed real ChatGPT conversation id fixture', () => {
    const source = `${FAKE_LONG_ID}:${FAKE_SWITCH_ID}`;
    expect(source).toContain('fake-');
    expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  });
});
