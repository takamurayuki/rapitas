/**
 * assistant
 *
 * What ラピ (the resident avatar) is allowed to do on the user's behalf, and
 * the record of what it did.
 *
 * The registry is the single declaration of the surface: a route may act only
 * through a capability declared there, and one that writes may not run without
 * the user's confirmation. Proposing writes nothing.
 */
export {
  buildTaskDraft,
  type TaskDraft,
  type ThemeRef,
  type DraftField,
  type DraftReason,
} from './task-draft';

export { readTaskIntent, type IntentDraft, type ThemeChoice } from './intent-reader';

export {
  proposeDeletions,
  CANDIDATE_WINDOW,
  type DeleteProposal,
  type DeleteCandidate,
  type DeleteCandidateInput,
} from './delete-proposal';

export {
  ASSISTANT_CAPABILITIES,
  assertCapabilityAllowed,
  getCapability,
  isCapabilityId,
  UnknownCapabilityError,
  ConfirmationRequiredError,
  type AssistantCapability,
  type AssistantCapabilityId,
  type UndoCost,
} from './capabilities';

export {
  recordAction,
  listRecentActions,
  type AssistantActionStatus,
  type AssistantActionRecord,
  type RecordActionInput,
} from './action-log';
