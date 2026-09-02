import type { GuardConfig } from '../shared/config';
import type { DebugMetrics } from '../shared/types';

function visible(element: Element): boolean {
  const html = element as HTMLElement;
  return html.offsetParent !== null || getComputedStyle(html).position === 'fixed';
}

export function hasUnsafeInteractiveState(root: ParentNode = document): boolean {
  if (/\/(?:auth|oauth|authorize)(?:\/|$)/i.test(location.pathname)) return true;
  const stop = root.querySelector('[data-testid="stop-button"], button[aria-label*="stop" i]');
  if (stop && visible(stop)) return true;

  for (const dialog of root.querySelectorAll('[role="dialog"], [data-testid*="confirmation" i], [data-testid*="permission" i], [data-testid*="oauth" i], [aria-label*="permission" i]')) {
    if (visible(dialog)) return true;
  }

  for (const input of root.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
    if (input.files && input.files.length > 0) return true;
  }

  return false;
}

export class HardSwitchGuard {
  private minDocumentNodes = Number.POSITIVE_INFINITY;
  private minHeapMb = Number.POSITIVE_INFINITY;
  private lastHardSwitchAt = 0;
  private count = 0;

  observe(metrics: DebugMetrics): void {
    if (metrics.totalDocumentDomNodes > 0) {
      this.minDocumentNodes = Math.min(this.minDocumentNodes, metrics.totalDocumentDomNodes);
    }
    if (metrics.jsHeapMb !== null && metrics.jsHeapMb > 0) {
      this.minHeapMb = Math.min(this.minHeapMb, metrics.jsHeapMb);
    }
  }

  shouldHardReload(config: GuardConfig, metrics: DebugMetrics): boolean {
    if (!config.hardSwitchEnabled || config.temporaryFullHistory) return false;
    if (metrics.spaSwitchCount < 30 || metrics.spaSwitchCount - this.lastHardSwitchAt < 30) return false;
    if (hasUnsafeInteractiveState()) return false;

    const nodeGrowth = Number.isFinite(this.minDocumentNodes) &&
      metrics.totalDocumentDomNodes > Math.max(this.minDocumentNodes + 8000, this.minDocumentNodes * 1.8);
    const heapGrowth = metrics.jsHeapMb !== null && Number.isFinite(this.minHeapMb) &&
      metrics.jsHeapMb > Math.max(this.minHeapMb + 300, this.minHeapMb * 1.7);

    return nodeGrowth || heapGrowth;
  }

  markHardReload(switchCount: number): void {
    this.lastHardSwitchAt = switchCount;
    this.count += 1;
  }

  get countPerformed(): number {
    return this.count;
  }
}
