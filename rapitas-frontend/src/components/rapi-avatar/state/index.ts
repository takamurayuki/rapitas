/**
 * rapi-avatar/state
 *
 * What ラピ shows: the pure phase-to-state resolution and the hook that feeds it.
 */
export {
  applyPhase,
  resolveAvatarState,
  DONE_HOLD_MS,
  ERROR_HOLD_MS,
  type AvatarSignals,
  type ResolvedAvatar,
  type TaskPhases,
} from './rapi-avatar-state';
export { useRapiAvatarState } from './useRapiAvatarState';
