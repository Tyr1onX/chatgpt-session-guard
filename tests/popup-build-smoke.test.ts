import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const popupHtml = readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8')) as { description?: string; version?: string };

function productionPopup(source: string): string {
  return source.replace(/\s*<!-- CSG_DEBUG_START -->[\s\S]*?<!-- CSG_DEBUG_END -->\s*/g, '\n');
}

describe('Chinese popup and build separation', () => {
  it('renders the user-facing popup in Simplified Chinese', () => {
    expect(popupHtml).toContain('<html lang="zh-CN">');
    expect(popupHtml).toContain('本版本保护情况');
    expect(popupHtml).toContain('合并重复历史请求');
    expect(popupHtml).toContain('阻止旧历史分页请求');
    expect(popupHtml).toContain('临时显示完整历史');
    expect(manifest.description).toContain('让超长 ChatGPT 会话保持轻量');
    expect(manifest.version).toBe('0.1.0');
  });

  it('production popup excludes debug-only tools', () => {
    const production = productionPopup(popupHtml);
    expect(production).toContain('本版本保护情况');
    expect(production).not.toContain('性能测试');
    expect(production).not.toContain('超长会话压力测试');
    expect(production).not.toContain('窗口稳定性诊断');
    expect(production).not.toContain('调试指标');
  });

  it('debug source retains diagnostics', () => {
    expect(popupHtml).toContain('性能测试');
    expect(popupHtml).toContain('超长会话压力测试');
    expect(popupHtml).toContain('窗口稳定性诊断');
    expect(popupHtml).toContain('导出诊断 JSON');
    expect(popupHtml).toContain('导出诊断报告');
    expect(popupHtml).toContain('调试指标');
  });
});
