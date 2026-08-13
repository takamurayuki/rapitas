/**
 * GitOperations — Branch and Pull Request Operations (barrel)
 *
 * Re-exports branch, pull request, merge, and revert operations from their
 * responsibility-specific modules, preserving this module's historical import
 * path for existing consumers and tests.
 * Not responsible for any logic of its own — implementation lives in
 * branch-ops / pr-create-ops / pr-merge-ops / revert-ops.
 */

export { createBranch } from './branch-ops';
export {
  FOREIGN_PR_ERROR_PREFIX,
  createPullRequest,
  type CreatePullRequestResult,
} from './pr-create-ops';
export { mergePullRequest } from './pr-merge-ops';
export { revertChanges } from './revert-ops';
