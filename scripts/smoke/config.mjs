import { readFile, writeFile } from 'node:fs/promises';
import { smokePaths } from './paths.mjs';

const ID_PATTERN = /^[A-Za-z0-9_-]{8,160}$/;

export function validateConversationId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function validateSmokeConfig(value) {
  if (!value || typeof value !== 'object') return { ok: false, error: 'MALFORMED_SMOKE_CONFIG' };
  const raw = value;
  if (!validateConversationId(raw.longConversationId)) {
    return { ok: false, error: 'LONG_CONVERSATION_ID_MISSING_OR_INVALID' };
  }
  const switches = Array.isArray(raw.switchConversationIds) ? raw.switchConversationIds : [];
  if (switches.some((item) => !validateConversationId(item))) {
    return { ok: false, error: 'SWITCH_CONVERSATION_ID_INVALID' };
  }
  const uniqueSwitches = [...new Set(switches.filter((item) => item !== raw.longConversationId))].slice(0, 3);
  return {
    ok: true,
    config: {
      schemaVersion: 1,
      longConversationId: raw.longConversationId,
      switchConversationIds: uniqueSwitches
    }
  };
}

export async function loadSmokeConfig(root = process.cwd()) {
  const { configPath } = smokePaths(root);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error('SMOKE_CONFIG_MISSING: run npm run smoke:setup first');
    }
    throw new Error('MALFORMED_SMOKE_CONFIG: run npm run smoke:setup again');
  }
  const result = validateSmokeConfig(parsed);
  if (!result.ok) throw new Error(`${result.error}: run npm run smoke:setup again`);
  return result.config;
}

export async function saveSmokeConfig(config, root = process.cwd()) {
  const result = validateSmokeConfig(config);
  if (!result.ok) throw new Error(result.error);
  const { configPath } = smokePaths(root);
  await writeFile(configPath, `${JSON.stringify(result.config, null, 2)}\n`, 'utf8');
  return result.config;
}
