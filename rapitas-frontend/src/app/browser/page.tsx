'use client';
/**
 * /browser
 *
 * The in-app browser's own screen, opened from the header's Compass button.
 *
 * The page draws only an empty slot. LinkViewHost — the one owner of the
 * docked webviews — portals the browser screen into it, so arriving here or
 * leaving never rebuilds a webview (nav60 §3.1).
 *
 * The route is fixed: the URL being viewed lives in the link-view store,
 * never in the query, so moving between pages adds nothing to the app
 * history and leaves no visited URL in it (nav60 §1.4).
 */
import { useBrowserScreenSlotStore } from '@/components/link-view/browser-screen/browser-screen-slot';

/** The browser screen's slot. */
export default function BrowserPage() {
  const setSlot = useBrowserScreenSlotStore((s) => s.setSlot);
  return <div ref={setSlot} data-browser-screen-slot="" className="min-h-0" />;
}
