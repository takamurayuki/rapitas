/**
 * rapi-avatar/panel
 *
 * The panel that opens next to ラピ: where a sentence went, the content area,
 * history, example sentences and the composer.
 */
export { RapiAvatarPanel } from './RapiAvatarPanel';
export { RapiComposer } from './RapiComposer';
export { RapiHistory, type AskedFor } from './RapiHistory';
export { RapiModeContent } from './RapiModeContent';
export { RapiModeHeader } from './RapiModeHeader';
export { RapiExamples, EXAMPLE_KEYS } from './RapiExamples';
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
