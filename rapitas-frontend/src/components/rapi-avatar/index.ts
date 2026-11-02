/**
 * rapi-avatar
 *
 * ラピ (Rapi), the character resident in the app shell, and the state it reflects.
 */
export { default as RapiAvatarHost } from './RapiAvatarHost';
export { RapiAvatar, RAPI_AVATAR_TOKENS, type RapiAvatarState } from './avatar/RapiAvatar';
export { RapiAvatarDock } from './avatar/RapiAvatarDock';
export { useRapiAvatarState } from './state/useRapiAvatarState';
export {
  applyPhase,
  resolveAvatarState,
  DONE_HOLD_MS,
  ERROR_HOLD_MS,
  type AvatarSignals,
} from './state/rapi-avatar-state';
