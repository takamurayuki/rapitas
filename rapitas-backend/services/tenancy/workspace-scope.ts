/**
 * WorkspaceScope
 *
 * Decides how one Prisma model operation must be rewritten so it can only see
 * or touch the current workspace. Pure: no Prisma, no database, no clock, no
 * async context — the caller supplies the workspace and the owned-model set.
 *
 * Why a pure core with a thin adapter: with ~50 owned models the alternative
 * is a `where: { workspaceId }` at every call site, where one miss returns
 * another workspace's rows and no realistic test covers every site. One
 * decision function can be enumerated — 50 models × 19 operations — and that
 * enumeration is in workspace-scope.test.ts.
 *
 * NOT responsible for: knowing which workspace is current (workspace-context),
 * which models are owned (owned-models), or calling Prisma (workspace-extension).
 */

/** Every operation a Prisma model delegate exposes, read off the client (19). */
export const MODEL_OPERATIONS = [
  'aggregate',
  'aggregateRaw',
  'count',
  'create',
  'createMany',
  'createManyAndReturn',
  'delete',
  'deleteMany',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findRaw',
  'findUnique',
  'findUniqueOrThrow',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
] as const;

export type ModelOperation = (typeof MODEL_OPERATIONS)[number];

/** Operations whose `where` can simply gain another condition. */
const WHERE_OPS = new Set<string>([
  'aggregate',
  'count',
  'delete',
  'deleteMany',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
]);

/**
 * `findUnique`'s `where` accepts ONLY unique fields, so adding `workspaceId`
 * to it is rejected by Prisma. The equivalent that does accept it is
 * `findFirst`, which returns the same shape for a unique filter.
 */
const UNIQUE_TO_FIRST: Record<string, string> = {
  findUnique: 'findFirst',
  findUniqueOrThrow: 'findFirstOrThrow',
};

/** Operations that create rows, so the workspace goes in `data`, not `where`. */
const CREATE_OPS = new Set<string>(['create', 'createMany', 'createManyAndReturn']);

/**
 * Mongo-only operations. They never reach a SQL provider at runtime, but the
 * delegate still exposes them, so they are classified rather than left to fall
 * through an `else`.
 */
const RAW_OPS = new Set<string>(['aggregateRaw', 'findRaw']);

/**
 * `upsert` cannot be run as itself: its `where` takes only unique fields, so
 * `workspaceId` cannot be added to it, and running it unscoped could update
 * another workspace's row.
 *
 * Stage 2 refused it and left a note saying each of the 7 call sites then on
 * owned models needed an explicit findFirst + create/update. Two things made
 * that the wrong place to fix it. The owned set has since grown, so there are
 * 32 such call sites — among them the workflow artifact save, auto-run
 * start/stop, the notes service and the whole GitHub sync. And a refusal is
 * not inert: every one of those throws as soon as a session has a workspace.
 *
 * So the find-then-write happens here instead, once, where the workspace is
 * known and cannot be escaped on any branch. workspace-extension performs it.
 */
const EMULATED_OPS = new Set<string>(['upsert']);

/** What the adapter should do with this call. */
export type ScopeDecision =
  /** Not an owned model, or no workspace in context: run it unchanged. */
  | { kind: 'passthrough' }
  /** Run the same operation with these args. */
  | { kind: 'scoped'; args: Record<string, unknown> }
  /** Run a DIFFERENT operation with these args (findUnique → findFirst). */
  | { kind: 'rewritten'; operation: string; args: Record<string, unknown> }
  /**
   * Perform an upsert as three scoped calls: find inside the workspace, then
   * update that row or create one stamped with the workspace.
   */
  | {
      kind: 'upsert';
      /** findFirst filter — the caller's, plus the workspace. */
      where: Record<string, unknown>;
      /** create data — the caller's, with the workspace stamped on. */
      create: Record<string, unknown>;
      /** update data, unchanged: the row found is already in the workspace. */
      update: Record<string, unknown>;
      /** The caller's other options (select, include) for the write. */
      rest: Record<string, unknown>;
    }
  /** Refuse: scoping is impossible and running it could cross workspaces. */
  | { kind: 'reject'; reason: string };

export interface ScopeInput {
  model: string;
  operation: string;
  args: unknown;
  /** Null when nothing has established a workspace — stage 2 fails OPEN. */
  workspaceId: number | null;
  ownedModels: ReadonlySet<string>;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);

/**
 * Is this `where` entry Prisma's compound-unique shorthand?
 *
 * Prisma names a compound unique by joining its field names with `_`, and the
 * value is an object of exactly those fields. The join order is checked first,
 * then a sorted comparison for a caller who wrote them in another order. Both
 * fail when a field name itself contains `_`, and that is deliberate: a wrong
 * guess here would tear a relation filter or an operator object apart into a
 * silently different query, whereas declining leaves the loud Prisma error.
 *
 * @param key - The `where` key / where のキー
 * @param value - Its value / その値
 * @returns True when the pair is a compound-unique shorthand / 複合ユニークならtrue
 */
function isCompoundUniqueEntry(key: string, value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const fields = Object.keys(value);
  if (fields.length < 2) return false;
  if (key === fields.join('_')) return true;
  const parts = key.split('_');
  if (parts.length !== fields.length) return false;
  return [...parts].sort().join('\u0000') === [...fields].sort().join('\u0000');
}

/**
 * Flattens any compound-unique shorthand in a `where` into its own fields.
 *
 * NOTE: Needed because `findUnique`'s where accepts that shorthand and
 * `findFirst`'s does not — copying it across made Prisma reject the call with
 * "Unknown argument `userId_taskTitle_themeId`", which 500'd every task
 * completion once workspaces went live (#1307). Both places that turn a unique
 * where into a findFirst filter run this.
 *
 * @param where - The caller's unique `where` / 呼び出し側の where
 * @returns An equivalent filter findFirst accepts / findFirst が受ける同等の filter
 */
function flattenUniqueWhere(where: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(asRecord(where))) {
    if (isCompoundUniqueEntry(key, value)) Object.assign(out, value);
    else out[key] = value;
  }
  return out;
}

/**
 * Decide how to rewrite one operation so it stays inside a workspace.
 *
 * @param input - Model, operation, args, current workspace and owned set / 対象と文脈
 * @returns What the caller should run instead / 実行すべき内容
 */
export function scopeOperation(input: ScopeInput): ScopeDecision {
  const { model, operation, args, workspaceId, ownedModels } = input;

  // NOTE: fails OPEN on purpose while stage 2 is inert — nothing establishes a
  // workspace yet, so every call must behave exactly as it did before. Stage 3
  // replaces this with a refusal once a session always resolves one.
  if (workspaceId === null) return { kind: 'passthrough' };
  if (!ownedModels.has(model)) return { kind: 'passthrough' };
  if (RAW_OPS.has(operation)) return { kind: 'passthrough' };

  if (EMULATED_OPS.has(operation)) {
    const next = asRecord(args);
    const { where, create, update, ...rest } = next;
    // `workspaceId` goes in LAST on both, so a caller that passed one of its
    // own cannot choose the workspace it reads from or writes to.
    return {
      kind: 'upsert',
      // The unique `where` becomes a findFirst filter, so the compound-unique
      // shorthand has to be flattened here too (#1307).
      where: { ...flattenUniqueWhere(where), workspaceId },
      create: { ...asRecord(create), workspaceId },
      update: asRecord(update),
      rest,
    };
  }

  if (CREATE_OPS.has(operation)) {
    const next = asRecord(args);
    const data = next.data;
    if (Array.isArray(data)) {
      next.data = data.map((row) => ({ ...asRecord(row), workspaceId }));
    } else {
      next.data = { ...asRecord(data), workspaceId };
    }
    return { kind: 'scoped', args: next };
  }

  const rewritten = UNIQUE_TO_FIRST[operation];
  if (rewritten !== undefined) {
    const next = asRecord(args);
    next.where = { ...flattenUniqueWhere(next.where), workspaceId };
    return { kind: 'rewritten', operation: rewritten, args: next };
  }

  if (WHERE_OPS.has(operation)) {
    const next = asRecord(args);
    next.where = { ...asRecord(next.where), workspaceId };
    return { kind: 'scoped', args: next };
  }

  // An operation this module has never heard of. Refusing is the only safe
  // answer: passing it through would be an unscoped query on owned data, and
  // that is the failure this whole file exists to prevent.
  return {
    kind: 'reject',
    reason: `${model}.${operation} is not classified by workspace-scope; refusing rather than running it unscoped.`,
  };
}
