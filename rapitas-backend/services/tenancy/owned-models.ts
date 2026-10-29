/**
 * OwnedModels
 *
 * Which Prisma models carry their own `workspaceId`, derived from the GENERATED
 * client rather than from a hand-written list.
 *
 * A hand-written list of ~50 model names drifts the first time someone adds a
 * model: the name is missing, the model is silently never scoped, and its rows
 * belong to everyone. The generated client cannot drift from the schema it was
 * generated from — if the column is there, this sees it.
 *
 * NOT responsible for deciding what to do with an owned model — see
 * workspace-scope.
 */
import { dbProvider } from '../../config/prisma-client-resolver';

/** Tenancy's own tables: they carry the column but must never be filtered by it. */
const EXEMPT = new Set(['Workspace', 'WorkspaceMember']);

interface DmmfField {
  name: string;
}
interface DmmfModel {
  name: string;
  fields: DmmfField[];
}

let cached: ReadonlySet<string> | null = null;

/**
 * Model names that carry `workspaceId` and should be scoped.
 *
 * Synchronous on purpose: config/database.ts builds the client at module load
 * and is imported by ~142 modules, so making it await here would turn that
 * singleton into an async import and change initialisation order. The
 * resolver already loads the generated client with `require`, so the DMMF is
 * available without going async.
 *
 * @returns The owned-model set, computed once / 所有モデル集合(初回のみ計算)
 */
export function getOwnedModels(): ReadonlySet<string> {
  if (cached) return cached;
  const mod = (
    dbProvider === 'SQLite'
      ? require('../../generated/prisma-sqlite')
      : require('../../generated/prisma-postgres')
  ) as { Prisma: { dmmf: { datamodel: { models: DmmfModel[] } } } };
  const owned = new Set<string>();
  for (const m of mod.Prisma.dmmf.datamodel.models) {
    if (EXEMPT.has(m.name)) continue;
    if (m.fields.some((f) => f.name === 'workspaceId')) owned.add(m.name);
  }
  cached = owned;
  return owned;
}

/** Test seam: forget the memoised set so a test can assert it is recomputed. */
export function resetOwnedModelsCache(): void {
  cached = null;
}

export { EXEMPT as TENANCY_OWN_MODELS };
