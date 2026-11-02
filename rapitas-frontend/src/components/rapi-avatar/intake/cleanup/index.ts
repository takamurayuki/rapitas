/**
 * rapi-avatar/intake/cleanup
 *
 * Clearing tasks away through ラピ: by proposal, by filter, and tidying.
 */
export { TaskCleanup } from './TaskCleanup';
export { TaskBulkCleanup } from './TaskBulkCleanup';
export { TaskTidy } from './TaskTidy';
export {
  useDeleteFilter,
  type UseDeleteFilter,
  type FilterMatch,
  type DeleteFilterCriteria,
} from './use-delete-filter';
export {
  useDeleteProposal,
  type UseDeleteProposal,
  type DeleteCandidate,
  type DeletionResult,
} from './use-delete-proposal';
