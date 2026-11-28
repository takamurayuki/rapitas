/**
 * recheck (barrel)
 *
 * Public API of the implementer re-check for companions selected without a
 * plan (task 1572): the mark and hold state, the opponent rules and the gate.
 */
export {
  RECHECK_PENDING_CAUSE,
  RECHECK_HELD_CAUSE,
  RECHECK_PASSED_CAUSE,
  isPlanlessCandidate,
  writePendingMark,
  readRecheckMark,
  readLastHeldSignature,
  heldSignature,
  isParallelRecheckHeld,
  getRecheckHold,
  setRecheckHold,
  markRecheckHoldLogged,
  resetRecheckHoldState,
  type RecheckMark,
  type RecheckHold,
} from './recheck-state';
export {
  collectRecheckOpponents,
  dropNewerMarked,
  createModeAwareReader,
  type RecheckOpponent,
} from './recheck-opponents';
export {
  guardParallelRecheck,
  type RecheckGateDeps,
  type RecheckGateOutcome,
  type RecheckGateTask,
} from './recheck-gate';
export { holdImplementer, noOpponent, type HoldInput, type HoldContext } from './recheck-hold';
