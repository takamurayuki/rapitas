/**
 * workflow/publish
 *
 * Publication helpers shared by the commit/PR route and the workflow services
 * (review hold, verify gates): the publish binding, git tree identity, the
 * commit/PR result type, the injected override publisher, and the
 * latest-execution failure marker.
 *
 * NOTE: Callers import the specific files, not this barrel: the binding module
 * loads its DB/git dependencies lazily, and the barrel would pull them in.
 */
export {
  resolvePublishWorktree,
  publishBindingDrift,
  checkBindingBeforeCommit,
  bindingDriftAfterCommit,
  type PublishBinding,
} from './workflow-auto-commit-binding';
export { stagedTreeIdentity, committedTreeIdentity } from './workflow-auto-commit-tree-identity';
export type { AutoCommitPRResult } from './workflow-auto-commit-types';
export type { OverridePublisher } from './override-publisher';
export { markLatestExecutionFailed } from './mark-latest-execution-failed';
