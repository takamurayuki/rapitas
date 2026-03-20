'use client';
import { useEffect } from 'react';
import { setupExternalLinkHandlers } from '@/utils/external-links';
import { useSplitViewExit } from '@/hooks/useSplitViewExit';

interface ExternalLinksProviderProps {
  children: React.ReactNode;
}

/**
 * ExternalLinksProvider
 *
 * Globally applies split-view handling for external links.
 * Sets up external link handlers on page load and dynamic content changes.
 * Also provides Esc key to exit split view.
 */
export default function ExternalLinksProvider({
  children,
}: ExternalLinksProviderProps) {
  // Enable split view exit functionality
  useSplitViewExit();

  useEffect(() => {
    // Set up handlers on initial load
    setupExternalLinkHandlers();

    // Debounce timer
    let debounceTimer: NodeJS.Timeout | null = null;

    // Use MutationObserver to watch for dynamically added links
    const observer = new MutationObserver((mutations) => {
      // Check if any newly added nodes contain anchor tags
      const hasNewLinks = mutations.some((mutation) => {
        if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) {
          return false;
        }

        // Check added nodes for anchor elements
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            if (element.tagName === 'A' || element.querySelector('a')) {
              return true;
            }
          }
        }
        return false;
      });

      if (hasNewLinks) {
        // Clear existing timer
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        // Debounce execution so multiple rapid DOM changes trigger only one handler call
        debounceTimer = setTimeout(() => {
          setupExternalLinkHandlers();
          debounceTimer = null;
        }, 100);
      }
    });

    // Observe the entire DOM
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Cleanup
    return () => {
      observer.disconnect();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, []);

  return <>{children}</>;
}
