/**
 * browser-screen
 *
 * The in-app browser's full-screen layout (/browser) and the pieces the
 * docked pane shares with it: the band row, favourites saving, the webview
 * report listener and clear-browsing-data.
 */
export { BrowserScreen } from './BrowserScreen';
export { LinkBandBar } from './LinkBandBar';
export { useBrowserScreenSlotStore, isBrowserRoute, BROWSER_ROUTE } from './browser-screen-slot';
export { useClearBrowsingData } from './useClearBrowsingData';
export { saveTabToFavourites } from './save-favourite';
export { useLinkViewReports, SLOW_LOAD_MS } from './useLinkViewReports';
