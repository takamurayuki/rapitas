/**
 * header/history
 *
 * Public API of the header's back/forward feature: the buttons, the in-app
 * history store that decides whether they are enabled, and the sync hook that
 * keeps that store in step with the browser's session history.
 */
export { HistoryNavButtons } from './HistoryNavButtons';
export {
  useNavigationHistoryStore,
  selectCanGoBack,
  selectCanGoForward,
} from './navigation-history-store';
export {
  installNavigationHistorySync,
  useNavigationHistorySync,
  NAV_HISTORY_STATE_KEY,
} from './navigation-history-sync';
