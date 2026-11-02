/**
 * rapi-avatar/panel
 *
 * The panel that opens above ラピ: its mode tabs, content area, history and the composer.
 */
export { RapiAvatarPanel } from './RapiAvatarPanel';
export { RapiComposer } from './RapiComposer';
export { RapiHistory, type AskedFor } from './RapiHistory';
export { RapiModeContent } from './RapiModeContent';
export { RapiModeTabs } from './RapiModeTabs';
export {
  RapiPrompt,
  type PromptDestination,
  type Routed,
  type RapiPromptProps,
} from './RapiPrompt';
export {
  MAX_HISTORY,
  DEFAULT_MODE,
  MODE_ICONS,
  visibleModes,
  reachableModes,
  type PanelMode,
} from './rapi-modes';
