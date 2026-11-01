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
  interpretQuestion,
  runTaskQuery,
  MAX_ANSWER_ROWS,
  type TaskQuery,
  type TaskQueryAnswer,
  type TaskQueryRow,
} from './task-query';

export {
  previewDeleteFilter,
  FILTERABLE_STATUSES,
  MAX_PREVIEW_ROWS,
  type DeleteFilterInput,
  type DeleteFilterResult,
  type FilterMatch,
} from './delete-filter';

export {
  proposeDeletions,
  CANDIDATE_WINDOW,
  type DeleteProposal,
  type DeleteCandidate,
  type DeleteCandidateInput,
} from './delete-proposal';

export {
  draftRoadmap,
  MAX_ROADMAP_STEPS,
  MAX_ROADMAP_QUESTIONS,
  type RoadmapDraft,
  type RoadmapStep,
  type RoadmapQuestion,
  type Placement,
  type NamedRef,
} from './roadmap-draft';

export {
  askProfileQuestions,
  composeProfile,
  MAX_PROFILE_QUESTIONS,
  MAX_PROFILE_ROUNDS,
  type ProfileAnswer,
  type ProfileQuestion,
  type ProfileComposition,
} from './profile-interview';

export {
  researchCandidates,
  MAX_CANDIDATES,
  RESEARCH_TIMEOUT_MS,
  type Candidate,
  type ResearchFindings,
} from './research';

export {
  commitRoadmap,
  type ApprovedPlan,
  type ApprovedPlacement,
  type ApprovedStep,
  type RoadmapResult,
} from './roadmap-commit';

export {
  routeIntent,
  ROUTABLE_INTENTS,
  type RoutableIntent,
  type RoutedIntent,
} from './intent-router';

export {
  surveyBacklog,
  SUPERVISION_CATEGORIES,
  MAX_SUPERVISION_ROWS,
  STALLED_AFTER_DAYS,
  type SupervisionCategory,
  type SupervisionFinding,
  type SupervisionSurvey,
  type SupervisedTask,
} from './supervision';

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
