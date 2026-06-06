/**
 * GitHub Pull Request Operations
 *
 * Barrel re-export combining pr-read.ts and pr-write.ts.
 * Consumers can continue to import from this single path.
 * Not responsible for any PR operation implementation.
 */

export {
  getPullRequests,
  getPullRequest,
  getPullRequestDiff,
  getPullRequestReviews,
  getPullRequestComments,
} from './pr-read';

export {
  createPullRequestComment,
  approvePullRequest,
  requestChanges,
  mergePullRequest,
  createPullRequest,
} from './pr-write';
