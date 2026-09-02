import { EVENTS } from '../shared/events';

export function extractConversationId(pathname: string): string | null {
  const match = pathname.match(/^\/c\/([^/?#]+)/);
  return match?.[1] ?? null;
}

export class NavigationObserver {
  private lastHref = '';
  private lastConversationId: string | null | undefined;
  private abortController: AbortController | null = null;

  constructor(
    private readonly onNavigate: (conversationId: string | null) => void,
    private readonly onSameConversationMutation?: (conversationId: string) => void
  ) {}

  start(): void {
    if (this.abortController) return;
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    const check = (): void => {
      if (location.href === this.lastHref) return;
      this.lastHref = location.href;
      const conversationId = extractConversationId(location.pathname);
      const previous = this.lastConversationId;
      this.lastConversationId = conversationId;

      if (previous === undefined || previous !== conversationId) {
        this.onNavigate(conversationId);
        return;
      }
      if (conversationId) this.onSameConversationMutation?.(conversationId);
    };

    window.addEventListener(EVENTS.navigation, check, { signal });
    window.addEventListener('popstate', check, { signal });
    window.addEventListener('hashchange', check, { signal });

    const nav = (window as Window & { navigation?: EventTarget }).navigation;
    nav?.addEventListener('navigate', check, { signal });
    check();
  }

  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.lastHref = '';
    this.lastConversationId = undefined;
  }
}
