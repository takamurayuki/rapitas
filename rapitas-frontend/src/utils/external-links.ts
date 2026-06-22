/**
 * External link utility functions
 */
import { openExternalUrlInSplitView } from '@/utils/tauri';

/**
 * Determine if a URL is an external link
 */
export function isExternalLink(href: string): boolean {
  try {
    // Treat relative, anchor, and mailto links as internal
    if (
      href.startsWith('/') ||
      href.startsWith('#') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:')
    ) {
      return false;
    }

    const url = new URL(href);
    const currentHost = window.location.hostname;

    // Same domain is treated as internal
    return url.hostname !== currentHost;
  } catch {
    // Treat as internal if URL parsing fails
    return false;
  }
}

/**
 * Open an external link side-by-side with rapitas (split screen) using the
 * chosen browser (App Settings) on Tauri, or a new tab on the web.
 */
export function openExternalLink(href: string): void {
  void openExternalUrlInSplitView(href);
}

/**
 * Handle click events on external links
 */
export function handleExternalLinkClick(
  event: React.MouseEvent<HTMLAnchorElement> | MouseEvent,
  href: string,
): void {
  // Preserve default behavior for Ctrl/Cmd+click and middle-click
  if (event.ctrlKey || event.metaKey || event.button === 1) {
    return;
  }

  // Open external links in the OS default browser.
  if (isExternalLink(href)) {
    event.preventDefault();
    event.stopPropagation();

    // NOTE: Only call stopImmediatePropagation for native events
    if (
      'stopImmediatePropagation' in event &&
      typeof event.stopImmediatePropagation === 'function'
    ) {
      event.stopImmediatePropagation();
    }

    openExternalLink(href);
  }
}

/**
 * Automatically set click handlers on link and anchor tags
 */
export function setupExternalLinkHandlers(): void {
  const links = document.querySelectorAll('a[href]');

  links.forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;

    // NOTE: Skip links inside contentEditable (note editor, etc.)
    if ((link as HTMLElement).isContentEditable) return;

    if (isExternalLink(href)) {
      // Remove old event listener if exists
      const existingHandler = (
        link as HTMLAnchorElement & { __externalLinkHandler?: EventListener }
      ).__externalLinkHandler;
      if (existingHandler) {
        link.removeEventListener('click', existingHandler, true);
        delete (link as HTMLAnchorElement & { __externalLinkHandler?: EventListener })
          .__externalLinkHandler;
      }

      // NOTE: Create listener in capture phase to run before other handlers
      const newHandler = (event: Event) => {
        handleExternalLinkClick(event as MouseEvent, href);
      };

      // Register event listener (capture phase)
      link.addEventListener('click', newHandler, true);

      // Save handler reference for later removal
      (
        link as HTMLAnchorElement & { __externalLinkHandler?: EventListener }
      ).__externalLinkHandler = newHandler;

      link.setAttribute('data-external-handler-set', 'true');

      // NOTE: Remove target="_blank" to prevent default browser behavior
      if (link.hasAttribute('target')) {
        link.removeAttribute('target');
      }
    }
  });
}
