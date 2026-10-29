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
 * Whether Prisma refused a write because a unique constraint already held.
 *
 * Used to tell "someone else created this row while we were looking" apart
 * from a real failure — the one case where the emulated upsert retries.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Perform an upsert as scoped calls, since Prisma's own cannot take a
 * workspace. Every owned model has a single scalar `id` (checked against the
 * schema), so the row found inside the workspace can be re-keyed by it.
 *
 * The create branch can lose a race, and the unique constraint is what says
 * so: `@@unique([workspaceId, ...])` makes a second insert for the same key in
 * the same workspace fail rather than duplicate. That failure is turned back
 * into the update branch once — which is the behaviour a real upsert has.
 *
 * @param delegate - The UNEXTENDED delegate for this model / 未拡張のデリゲート
 * @param decision - Where to look, and what to write / 探索条件と書き込み内容
 * @returns The updated or created row / 更新または作成された行
 */
async function runEmulatedUpsert(
  delegate: Record<string, (args: unknown) => Promise<unknown>>,
  decision: { where: object; create: object; update: object; rest: object },
): Promise<unknown> {
  const locate = { where: decision.where, select: { id: true } };
  const found = (await delegate.findFirst(locate)) as { id: unknown } | null;
  if (found !== null) {
    return delegate.update({ ...decision.rest, where: { id: found.id }, data: decision.update });
  }
  try {
    return await delegate.create({ ...decision.rest, data: decision.create });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = (await delegate.findFirst(locate)) as { id: unknown } | null;
    // The constraint fired but the row is not visible in this workspace, so
    // the collision was with a global constraint, not with our own row.
    // Reporting the original error is the honest answer.
    if (raced === null) throw error;
    return delegate.update({ ...decision.rest, where: { id: raced.id }, data: decision.update });
  }
}

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
            case 'upsert': {
              const delegate = base[delegateName(model)];
              if (typeof delegate?.findFirst !== 'function') {
                throw new Error(
                  `[tenancy] cannot emulate ${model}.upsert: no findFirst on the base client`,
                );
              }
              log.debug({ model }, '[tenancy] upsert performed as a scoped find-then-write');
              return runEmulatedUpsert(delegate, decision);
            }
            case 'reject':
              throw new Error(`[tenancy] ${decision.reason}`);
          }
        },
      },
    },
  };
}
