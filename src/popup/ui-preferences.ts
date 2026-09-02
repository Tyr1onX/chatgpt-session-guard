import type { LanguagePreference } from './i18n';

export const UI_STORAGE_KEY = 'csg.ui.v1';

export interface UiPreferences {
  language: LanguagePreference;
  ultraLiteNoticeSeen: boolean;
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  language: 'auto',
  ultraLiteNoticeSeen: false
};

export interface PreferenceStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export function normalizeUiPreferences(input: unknown): UiPreferences {
  const raw = typeof input === 'object' && input !== null
    ? input as Partial<UiPreferences>
    : {};
  const language = raw.language === 'zh-CN' || raw.language === 'en' || raw.language === 'auto'
    ? raw.language
    : DEFAULT_UI_PREFERENCES.language;
  return {
    language,
    ultraLiteNoticeSeen: raw.ultraLiteNoticeSeen === true
  };
}

export async function loadUiPreferences(storage: PreferenceStorage): Promise<UiPreferences> {
  const stored = await storage.get(UI_STORAGE_KEY);
  return normalizeUiPreferences(stored[UI_STORAGE_KEY]);
}

export async function saveUiPreferences(storage: PreferenceStorage, preferences: UiPreferences): Promise<UiPreferences> {
  const normalized = normalizeUiPreferences(preferences);
  await storage.set({ [UI_STORAGE_KEY]: normalized });
  return normalized;
}
