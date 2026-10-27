/**
 * Tenancy
 *
 * Workspace scoping: which workspace a unit of work belongs to, and the single
 * place every Prisma query passes through to be narrowed to it.
 *
 * NOT responsible for resolving a request to a workspace — that is stage 3,
 * and it is the only thing still missing before scoping takes effect.
 */
export { runInWorkspace, currentWorkspaceId, runAcrossAllWorkspaces } from './workspace-context';
export { getOwnedModels, resetOwnedModelsCache, TENANCY_OWN_MODELS } from './owned-models';
export { createWorkspaceExtension, type BaseClientLike } from './workspace-extension';
export {
  scopeOperation,
  MODEL_OPERATIONS,
  type ModelOperation,
  type ScopeDecision,
  type ScopeInput,
} from './workspace-scope';
