import {
  benchmarkFilename,
  benchmarkReport,
  type BenchmarkState
} from '../shared/benchmark';

const UI_ID = 'csg-benchmark-ui';

function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.documentElement.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function latestSample(state: BenchmarkState) {
  if (state.phase === 'session-gc') return state.sessionGc?.samples.at(-1) ?? null;
  const mode = state.modeOrder[Math.min(state.modeIndex, state.modeOrder.length - 1)];
  if (!mode) return null;
  return state.results[mode].samples.at(-1) ?? null;
}

function modeLabel(value: string): string {
  const labels: Record<string, string> = {
    control: 'Control',
    safe: '安全',
    balanced: '均衡',
    'ultra-lite': '极简',
    aggressive: '激进',
    complete: '完成'
  };
  return labels[value] ?? value;
}

export class BenchmarkStatusUi {
  private root: HTMLDivElement | null = null;

  constructor(
    private readonly onStop: () => void,
    private readonly onResume: () => void,
    private readonly onSessionGc: () => void
  ) {}

  render(state: BenchmarkState | null): void {
    if (!state) {
      this.remove();
      return;
    }
    const root = this.ensureRoot();
    const sample = latestSample(state);
    const mode = state.phase === 'session-gc'
      ? 'Session GC'
      : modeLabel(state.modeOrder[Math.min(state.modeIndex, state.modeOrder.length - 1)] ?? 'complete');
    const progress = state.status === 'complete'
      ? `${state.switchesPerMode} / ${state.switchesPerMode}`
      : `${state.currentSwitch} / ${state.switchesPerMode}`;
    const heap = sample?.jsHeapMb === null || sample?.jsHeapMb === undefined ? '不可用' : `${sample.jsHeapMb.toFixed(1)} MB`;
    const latency = sample?.switchLatencyMs === null || sample?.switchLatencyMs === undefined ? '不可用' : `${sample.switchLatencyMs.toFixed(1)} ms`;
    const busy = state.pauseReason ? '<div class="csg-bench-note">测试已暂停，请确认 ChatGPT 当前没有正在进行的任务后再继续。</div>' : '';
    const recommended = state.results.aggressive.analysis?.spaRetainedStateLikely === true && !state.sessionGc
      ? '<div class="csg-bench-note">建议补充运行 Session GC 测试。</div>'
      : '';

    root.innerHTML = `
      <div class="csg-bench-title">ChatGPT Session Guard</div>
      <div class="csg-bench-subtitle">真实浏览器自动性能测试</div>
      <div class="csg-bench-grid">
        <span>会话数</span><strong>${state.conversationIds.length}</strong>
        <span>模式</span><strong>${this.escape(mode)}</strong>
        <span>进度</span><strong>${progress}</strong>
        <span>DOM</span><strong>${sample?.documentDomNodes ?? '不可用'}</strong>
        <span>堆内存</span><strong>${heap}</strong>
        <span>切换延迟</span><strong>${latency}</strong>
      </div>
      ${busy}
      ${recommended}
      <div class="csg-bench-actions"></div>
    `;

    const actions = root.querySelector<HTMLDivElement>('.csg-bench-actions');
    if (!actions) return;
    if (state.status === 'complete' || state.status === 'failed' || state.status === 'stopped') {
      const jsonButton = this.button('导出 JSON', () => {
        const timestamp = state.completedAt ?? Date.now();
        downloadText(
          benchmarkFilename('benchmark-results', timestamp, 'json'),
          JSON.stringify(state, null, 2),
          'application/json;charset=utf-8'
        );
      });
      const reportButton = this.button('导出报告', () => {
        const timestamp = state.completedAt ?? Date.now();
        downloadText(
          benchmarkFilename('benchmark-report', timestamp, 'md'),
          benchmarkReport(state),
          'text/markdown;charset=utf-8'
        );
      });
      actions.append(jsonButton, reportButton);
      if (state.results.aggressive.analysis?.spaRetainedStateLikely === true && !state.sessionGc) {
        actions.append(this.button('运行 Session GC 测试', this.onSessionGc));
      }
      return;
    }

    if (state.status === 'paused-user') {
      actions.append(this.button('继续测试', this.onResume));
    }
    actions.append(this.button('停止测试', this.onStop));
  }

  remove(): void {
    this.root?.remove();
    this.root = null;
  }

  private ensureRoot(): HTMLDivElement {
    if (this.root?.isConnected) return this.root;
    const root = document.createElement('div');
    root.id = UI_ID;
    root.dataset.csgBenchmarkUi = 'true';
    root.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483646',
      'width:280px',
      'box-sizing:border-box',
      'padding:12px',
      'border:1px solid color-mix(in srgb, currentColor 18%, transparent)',
      'border-radius:12px',
      'background:color-mix(in srgb, Canvas 96%, currentColor 4%)',
      'color:CanvasText',
      'box-shadow:0 8px 28px rgba(0,0,0,.18)',
      'font:12px/1.4 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    ].join(';');
    const style = document.createElement('style');
    style.textContent = `
      #${UI_ID} .csg-bench-title { font-weight: 700; font-size: 13px; }
      #${UI_ID} .csg-bench-subtitle { opacity: .68; margin: 1px 0 9px; }
      #${UI_ID} .csg-bench-grid { display:grid; grid-template-columns:1fr auto; gap:4px 10px; }
      #${UI_ID} .csg-bench-grid span { opacity:.68; }
      #${UI_ID} .csg-bench-note { margin-top:8px; padding:7px 8px; border-radius:8px; background:color-mix(in srgb, CanvasText 7%, transparent); }
      #${UI_ID} .csg-bench-actions { display:flex; gap:6px; margin-top:10px; flex-wrap:wrap; }
      #${UI_ID} button { border:1px solid color-mix(in srgb, currentColor 18%, transparent); background:Canvas; color:CanvasText; border-radius:8px; padding:6px 8px; cursor:pointer; font:inherit; }
    `;
    root.appendChild(style);
    document.documentElement.appendChild(root);
    this.root = root;
    return root;
  }

  private button(label: string, handler: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handler();
    });
    return button;
  }

  private escape(value: string): string {
    return value.replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    })[character] ?? character);
  }
}
