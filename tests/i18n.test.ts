import { describe, expect, it } from 'vitest';
import {
  isChineseLanguage,
  resolveLocale,
  translate,
  translationKeyCount,
  type MessageKey
} from '../src/popup/i18n';

describe('popup i18n', () => {
  it('defaults Auto to Simplified Chinese for a Chinese preferred language', () => {
    expect(resolveLocale('auto', ['zh-CN', 'en-US'])).toBe('zh-CN');
    expect(resolveLocale('auto', ['zh-SG'])).toBe('zh-CN');
    expect(resolveLocale('auto', ['zh-Hans-CN'])).toBe('zh-CN');
    expect(isChineseLanguage('zh')).toBe(true);
  });

  it('falls back to English for non-Chinese preferred languages', () => {
    expect(resolveLocale('auto', ['ja-JP', 'zh-CN'])).toBe('en');
    expect(resolveLocale('auto', ['en-US'])).toBe('en');
    expect(resolveLocale('auto', [])).toBe('en');
  });

  it('honors explicit manual language selection', () => {
    expect(resolveLocale('zh-CN', ['en-US'])).toBe('zh-CN');
    expect(resolveLocale('en', ['zh-CN'])).toBe('en');
  });

  it('provides required mode and dynamic history labels', () => {
    expect(translate('zh-CN', 'modeSafe')).toBe('安全模式');
    expect(translate('zh-CN', 'modeBalanced')).toBe('均衡模式');
    expect(translate('zh-CN', 'modeUltraLite')).toBe('极简模式');
    expect(translate('zh-CN', 'modeAggressive')).toContain('实验性');
    expect(translate('zh-CN', 'historyOneMessage')).toContain('极限');
    expect(translate('zh-CN', 'historyOneRound')).toBe('1 轮对话');
    expect(translate('zh-CN', 'loadPrevious', { count: 20 })).toBe('加载前 20 条');
    expect(translate('en', 'loadPrevious', { count: 20 })).toBe('Load previous 20');
  });

  it('keeps Ultra Lite guidance and disconnected-session copy clear', () => {
    expect(translate('zh-CN', 'modeUltraLiteUsage')).toContain('长会话');
    expect(translate('zh-CN', 'ultraLiteNotice')).toContain('不会删除');
    expect(translate('zh-CN', 'sessionUnavailable')).toBe('未连接');
    expect(translate('zh-CN', 'sessionUnavailableHelp')).toContain('刷新');
  });

  it('falls back safely for a missing translation key', () => {
    expect(translate('zh-CN', 'missingKey' as MessageKey)).toBe('missingKey');
  });

  it('maintains a centralized non-trivial dictionary', () => {
    expect(translationKeyCount()).toBeGreaterThan(80);
  });
});
