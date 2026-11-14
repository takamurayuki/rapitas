/**
 * rapi-avatar/avatar
 *
 * The drawn character: the sphere, its dock in the app shell and its speech bubble.
 */
export {
  RapiAvatar,
  RAPI_AVATAR_TOKENS,
  STARTLE_DURATION_MS,
  useAvatarName,
  useStateLabel,
  type RapiAvatarState,
  type RapiAvatarProps,
} from './RapiAvatar';
export { RapiAvatarDock, type RapiAvatarDockProps } from './RapiAvatarDock';
export {
  SpeechBubble,
  SPEAK_DURATION_MS,
  BUBBLE_COLORS,
  speakOrigin,
  bubbleRadius,
  type SpeechBubbleProps,
  type TailSide,
} from './SpeechBubble';
