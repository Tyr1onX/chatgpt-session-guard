import { describe, expect, it } from 'vitest';
import { STORAGE_KEY } from '../src/shared/config';
import {
  DEFAULT_UI_PREFERENCES,
  UI_STORAGE_KEY,
  loadUiPreferences,
  normalizeUiPreferences,
  saveUiPreferences,
  type PreferenceStorage
} from '../src/popup/ui-preferences';

function memoryStorage(initial: Record<string, unknown> = {}): { storage: PreferenceStorage; data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    storage: {
      async get(key: string) {
        return { [key]: data[key] };
      },
      async set(items: Record<string, unknown>) {
        Object.assign(data, items);
      }
    }
  };
}

describe('popup UI preferences', () => {
  it('defaults language to Auto without touching core settings', () => {
    expect(normalizeUiPreferences(null)).toEqual(DEFAULT_UI_PREFERENCES);
    expect(DEFAULT_UI_PREFERENCES.language).toBe('auto');
    expect(UI_STORAGE_KEY).not.toBe(STORAGE_KEY);
  });

  it.each(['zh-CN', 'en', 'auto'] as const)('persists manual language preference %s', async (language) => {
    const { storage, data } = memoryStorage();
    const saved = await saveUiPreferences(storage, { language, ultraLiteNoticeSeen: false });
    expect(saved.language).toBe(language);
    expect((data[UI_STORAGE_KEY] as { language: string }).language).toBe(language);
    expect((await loadUiPreferences(storage)).language).toBe(language);
  });

  it('persists the one-time Ultra Lite notice independently', async () => {
    const { storage } = memoryStorage();
    await saveUiPreferences(storage, { language: 'auto', ultraLiteNoticeSeen: true });
    expect(await loadUiPreferences(storage)).toEqual({ language: 'auto', ultraLiteNoticeSeen: true });
  });

  it('normalizes invalid stored UI values without affecting GuardConfig schema', () => {
    expect(normalizeUiPreferences({ language: 'xx', ultraLiteNoticeSeen: 'yes' })).toEqual(DEFAULT_UI_PREFERENCES);
  });
});
