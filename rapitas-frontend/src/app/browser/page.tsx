'use client';
/**
 * /browser
 *
 * The in-app browser's own screen, opened from the header's Compass button.
 * The route is fixed — the URL being viewed lives in the link-view store,
 * never in the query, so moving between pages adds nothing to the app
 * history and no visited URL is left in it.
 */
import { BrowserExternalStart } from './_components/BrowserExternalStart';

/** The browser screen. */
export default function BrowserPage() {
  return <BrowserExternalStart />;
}
