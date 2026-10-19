/**
 * rapi-avatar
 *
 * ラピ (Rapi), the character resident in the app shell, and the state it reflects.
 */
export { default as RapiAvatarHost } from './RapiAvatarHost';
export { RapiAvatar, RAPI_AVATAR_TOKENS, type RapiAvatarState } from './RapiAvatar';
export { RapiAvatarDock } from './RapiAvatarDock';
export { useRapiAvatarState } from './useRapiAvatarState';
export {
  applyPhase,
  resolveAvatarState,
  DONE_HOLD_MS,
  ERROR_HOLD_MS,
  type AvatarSignals,
} from './rapi-avatar-state';
