/**
 * link-view-events
 *
 * Listeners for what the docked webviews report beyond page changes: load
 * progress, navigations the Rust policy stopped, `window.open` requests (to
 * become tabs), and refused downloads. Event names and payloads match
 * `rapitas-desktop/src-tauri/src/link_webview/builder.rs`.
 *
 * The payload's `url` is shown as plain text at most — never parsed into an
 * instruction, a route or a search (nav60 §5.1).
 */
import { isTauri } from './tauri';
import { createLogger } from '@/lib/logger';

const logger = createLogger('link-view-events');

/** One report from a docked webview. */
export interface LinkViewTabEvent {
  /** The tab whose webview sent it. / 対象タブ */
  tabId: string;
  /** The URL concerned. / 対象 URL */
  url: string;
  /** `started`/`finished`, or why something was refused. / 詳細 */
  detail: string;
}

export const LINK_VIEW_EVENTS = {
  loadState: 'link-view://load-state',
  navigationBlocked: 'link-view://navigation-blocked',
  newWindow: 'link-view://new-window-requested',
  newWindowBlocked: 'link-view://new-window-blocked',
  downloadBlocked: 'link-view://download-blocked',
} as const;

export type LinkViewEventName = keyof typeof LINK_VIEW_EVENTS;

/**
 * Listen for one kind of docked-webview report.
 *
 * @param name - Which event / イベント種別
 * @param handler - Called with each report / ハンドラ
 * @returns Stop listening / 解除関数
 */
export async function onLinkViewEvent(
  name: LinkViewEventName,
  handler: (event: LinkViewTabEvent) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<LinkViewTabEvent>(LINK_VIEW_EVENTS[name], (event) =>
      handler(event.payload),
    );
  } catch (error) {
    logger.error(`Could not listen for ${name}:`, error);
    return () => {};
  }
}
