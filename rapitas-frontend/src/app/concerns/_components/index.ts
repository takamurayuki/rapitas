/**
 * ConcernsComponents
 *
 * Public barrel for the Concern Backlog feature. Re-exports the page entry
 * component (default) and the supporting hook/types for reuse.
 */
export { default } from './ConcernsClient';
export { default as ConcernsClient } from './ConcernsClient';
export { useConcerns } from './use-concerns';
export type {
  Concern,
  ConcernType,
  ConcernSeverity,
  ConcernStatus,
  GhIntegration,
  LinkedIssueRef,
} from './concern-shared';
