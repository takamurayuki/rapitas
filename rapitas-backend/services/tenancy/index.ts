/**
 * Tenancy
 *
 * Workspace scoping: which workspace a unit of work belongs to, and the single
 * place every Prisma query passes through to be narrowed to it.
 *
 * NOT responsible for authentication: a request that resolves to no workspace
 * is served unscoped, exactly as it was before tenancy existed.
 */
export { runInWorkspace, currentWorkspaceId, runAcrossAllWorkspaces } from './workspace-context';
export { wrapAppWithWorkspaceScope } from './workspace-request-wrapper';
export {
  readSessionToken,
  resolveWorkspaceForSession,
  clearSessionWorkspaceCache,
  forgetSessionWorkspace,
} from './session-workspace';
export { ensureWorkspaceForUser, ensureDefaultWorkspace } from './workspace-provisioning';
export {
  claimUnownedRows,
  countUnownedRows,
  type BackfillResult,
  type BackfillModelResult,
} from './workspace-backfill';
export { getOwnedModels, resetOwnedModelsCache, TENANCY_OWN_MODELS } from './owned-models';
export { createWorkspaceExtension, type BaseClientLike } from './workspace-extension';
export {
  scopeOperation,
  MODEL_OPERATIONS,
  type ModelOperation,
  type ScopeDecision,
  type ScopeInput,
} from './workspace-scope';
