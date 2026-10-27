/**
 * WorkspaceExtension
 *
 * The one place where workspace scoping is applied to Prisma. A thin adapter:
 * it reads the current workspace, asks workspace-scope what to do, and does
 * it. All the judgement lives in that pure function so it can be enumerated.
 *
 * Through stage 2 this is INERT — nothing calls runInWorkspace, so every
 * decision is `passthrough` and behaviour is identical to before tenancy
 * existed. Stage 3 establishes a workspace at the request boundary, and that
 * is when this starts changing results.
 *
 * NOT responsible for: resolving a session to a workspace, or for nested
 * writes — see the NOTE on createWorkspaceExtension.
 */
import { createLogger } from '../../config/logger';
import { currentWorkspaceId } from './workspace-context';
import { scopeOperation } from './workspace-scope';

const log = createLogger('tenancy:workspace-extension');

/** Minimal shape of what Prisma hands a `$allOperations` hook. */
interface OperationCall {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}

/** Just enough of a client to re-issue one call on a different operation. */
export type BaseClientLike = Record<string, Record<string, (args: unknown) => Promise<unknown>>>;

/** What `$extends` needs, without importing a provider-specific client type. */
export interface WorkspaceExtensionSpec {
  name: string;
  query: {
    $allModels: {
      $allOperations: (call: OperationCall) => Promise<unknown>;
    };
  };
}

/** `Category` → `category`, which is how a delegate is named on the client. */
const delegateName = (model: string): string => model.charAt(0).toLowerCase() + model.slice(1);

/**
 * Build the extension.
 *
 * `base` must be the UNEXTENDED client. `findUnique`'s `where` accepts only
 * unique fields, so the workspace cannot be added to it; the call is re-issued
 * as `findFirst` on the base client instead. Going through the base client is
 * what stops that re-issue from re-entering this hook — and even if it did,
 * `findFirst` is scoped by adding the same key again, which is idempotent.
 *
 * NOTE: Prisma hooks the operation the caller invoked, not the nested writes
 * inside its `data`. A nested create of an owned model (creating a Category
 * inline from `theme.create`, say) therefore bypasses this and leaves
 * workspaceId null. Roots have no owned parent by construction, so this is
 * only reachable through such an inline create; stage 4 makes the column NOT
 * NULL, which turns that silent gap into a write error.
 *
 * @param ownedModels - Models carrying their own workspaceId / 所有モデル集合
 * @param base - The unextended client, used to re-issue unique reads / 未拡張クライアント
 * @returns A Prisma client extension / Prisma クライアント拡張
 */
export function createWorkspaceExtension(
  ownedModels: ReadonlySet<string>,
  base: BaseClientLike,
): WorkspaceExtensionSpec {
  return {
    name: 'workspace-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: OperationCall) {
          const workspaceId = currentWorkspaceId();
          if (workspaceId === null || model === undefined) return query(args);

          const decision = scopeOperation({
            model,
            operation,
            args,
            workspaceId,
            ownedModels,
          });

          switch (decision.kind) {
            case 'passthrough':
              return query(args);
            case 'scoped':
              return query(decision.args);
            case 'rewritten': {
              const delegate = base[delegateName(model)];
              const run = delegate?.[decision.operation];
              if (typeof run !== 'function') {
                throw new Error(
                  `[tenancy] cannot re-issue ${model}.${operation} as ${decision.operation}: ` +
                    `no such operation on the base client`,
                );
              }
              log.debug(
                { model, from: operation, to: decision.operation },
                '[tenancy] unique read re-issued with a workspace filter',
              );
              return run.call(delegate, decision.args);
            }
            case 'reject':
              throw new Error(`[tenancy] ${decision.reason}`);
          }
        },
      },
    },
  };
}
