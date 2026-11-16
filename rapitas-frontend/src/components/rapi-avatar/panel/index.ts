/**
 * rapi-avatar/panel
 *
 * The panel that opens next to ラピ: the conversation with her and the box
 * you write in.
 */
export { RapiAvatarPanel } from './RapiAvatarPanel';
export {
  RapiPrompt,
  MIN_INPUT_PX,
  type PromptDestination,
  type RapiPromptProps,
} from './RapiPrompt';
export { MODE_ICONS, type PanelMode } from './rapi-modes';
export {
  RapiThread,
  useRapiConversation,
  MAX_MESSAGES,
  type RapiConversation,
  type RapiMessage,
  type RapiRole,
} from './conversation';
