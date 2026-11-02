/**
 * workspace-tenancy schema coverage
 *
 * Tenancy is only as good as its weakest table: a model the application reads
 * DIRECTLY needs its own `workspaceId`, or its rows belong to everyone.
 *
 * Stage 1 used a different rule — only "roots" (models with no owned parent)
 * needed the column, because "a child inherits its parent's workspace through
 * the foreign key". That is true of referential integrity and false of query
 * scoping: Prisma does not walk a foreign key when it filters, so
 * `prisma.task.findMany()` returns every workspace's tasks no matter what
 * `Category` says. Measured 2026-10-28 against a real client, with one
 * `Category -> Theme -> Task` chain seeded per workspace:
 *
 *     categoriesInWsA: 1   (owned — scoped)
 *     themesInWsA:     2   (derived — NOT scoped)
 *     tasksInWsA:      2   (derived — NOT scoped, workspace B's task by name)
 *
 * So the rule here is what the extension can actually enforce: every model
 * reached through the client by name carries the column. The set is derived by
 * scanning the backend source rather than listed, because a list drifts the
 * first time someone adds a query.
 *
 * NOT responsible for query behaviour — that is workspace-scope's enumeration
 * and workspace-scoping.integration.test.ts.
 */
import { describe, it, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const BACKEND_DIR = dirname(dirname(import.meta.dir));
const SCHEMA_DIR = join(BACKEND_DIR, 'prisma', 'schema');

interface Model {
  name: string;
  file: string;
  body: string;
}

function loadModels(): Model[] {
  const out: Model[] = [];
  for (const f of readdirSync(SCHEMA_DIR).filter((x) => x.endsWith('.prisma'))) {
    const text = readFileSync(join(SCHEMA_DIR, f), 'utf8');
    const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) out.push({ name: m[1], file: f, body: m[2] });
  }
  return out;
}

/** Directories with no application queries in them, or generated output. */
const SKIP_DIRS = new Set(['node_modules', 'generated', '.git', 'tests', 'dist', 'coverage']);

/**
 * Every production `.ts` file under the backend, concatenated.
 *
 * Tests are excluded on purpose: a model only a test touches does not need a
 * column, and fixtures would otherwise widen the requirement for free.
 *
 * @returns All production source text / 本番ソース全文
 */
function loadProductionSource(): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        parts.push(readFileSync(path, 'utf8'));
      }
    }
  };
  walk(BACKEND_DIR);
  return parts.join('\n');
}

const models = loadModels();
const source = loadProductionSource();

/** Prisma's delegate name for a model: `AIAgentConfig` -> `aIAgentConfig`. */
const delegateOf = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);

/**
 * Whether production code reaches this model by name through a client.
 *
 * `tx.` counts: 41 `$transaction` call sites read models through the
 * transaction handle (59 of them `tx.task`), and a model reached only that way
 * is just as unscoped as one reached through `prisma.`.
 *
 * @param name - Model name as declared in the schema / スキーマ上のモデル名
 * @returns Whether the model is queried directly / 直接参照されるか
 */
function isQueriedDirectly(name: string): boolean {
  const delegate = delegateOf(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:prisma|tx|client)\\.' + delegate + '\\.').test(source);
}

/**
 * Auth and tenancy's own models: scoping these would break logging in.
 *
 * `CalendarShare` (#1270) is here for the same kind of reason rather than as
 * an oversight. A grant row names TWO workspaces — `ownerWorkspaceId` and
 * `viewerWorkspaceId` — and has to be readable from both ends: the owner
 * lists who they share with, the viewer lists whose calendar they may see. A
 * `workspaceId` column would make getOwnedModels() filter it by whichever
 * workspace is current, which answers only one of those two questions. Its
 * access control is therefore explicit in every `where` instead, driven by
 * the caller's session in calendar-share-store.
 */
const EXEMPT = new Set(['User', 'UserSession', 'Workspace', 'WorkspaceMember', 'CalendarShare']);

const hasColumn = (m: Model): boolean => /^\s*workspaceId\s+Int\??/m.test(m.body);

const tenanted = models.filter((m) => !EXEMPT.has(m.name));
const queried = tenanted.filter((m) => isQueriedDirectly(m.name));
const owned = tenanted.filter(hasColumn);
const lacking = tenanted.filter((m) => !hasColumn(m));

describe('every directly-queried model carries workspaceId', () => {
  it('found the models and the source at all — the check is not vacuous', () => {
    expect(models.length).toBeGreaterThan(80);
    expect(source.length).toBeGreaterThan(1_000_000);
    expect(queried.length).toBeGreaterThan(70);
  });

  it.each(queried.map((q) => [q.name, q] as const))('%s has workspaceId', (_name, model) => {
    expect(hasColumn(model)).toBe(true);
  });

  it('every one also indexes it', () => {
    const missing = queried
      .filter((q) => !/@@index\(\[workspaceId\]\)/.test(q.body))
      .map((q) => `${q.name} [${q.file}]`);
    expect(missing).toEqual([]);
  });
});

describe('models with no column are only the ones nothing queries by name', () => {
  // Reached exclusively through a parent's `include`/`select`, where the
  // parent's own filter already decided the workspace. Pinned rather than
  // derived: if one of these gains a direct query it needs the column, and
  // this going red is the only thing that would notice.
  const NO_COLUMN = ['GitHubPRReview', 'RequirementReviewClaim', 'TaskDurationPrediction'];

  it('matches the recorded list exactly', () => {
    expect(lacking.map((m) => m.name).sort()).toEqual(NO_COLUMN);
  });

  it('none of them is queried directly — which is the whole reason they may skip it', () => {
    expect(lacking.filter((m) => isQueriedDirectly(m.name)).map((m) => m.name)).toEqual([]);
  });
});

describe('every uniqueness constraint is reachable by a second workspace', () => {
  /*
   * A unique index that does not account for the workspace stops the SECOND
   * workspace from creating its own row — it is not a filtering problem, it is
   * an insert that fails. There are two ways to be safe, and both are real:
   *
   *   1. the constraint names workspaceId, so each workspace has its own key
   *      space: @@unique([workspaceId, key])
   *   2. the constraint is over a foreign key to a model that is itself owned,
   *      so the parent already decided the workspace: @@unique([taskId, fileType])
   *      cannot collide, because a Task belongs to one workspace.
   *
   * Adding workspaceId to the second kind would be redundant churn, so the
   * rule accepts both. This used to be a pinned list of 34 names to work
   * through; 18 constraints across 17 models were made workspace-aware and the
   * rest were measured as safe by route 2, so the list is gone and the
   * invariant is enforced instead.
   */

  /** The model a scalar field is a foreign key to, or null. */
  const relationTarget = (body: string, field: string): string | null => {
    for (const line of body.split('\n')) {
      if (!line.includes('@relation')) continue;
      const fieldsPart = line.match(/fields:\s*\[([^\]]+)\]/);
      if (!fieldsPart) continue;
      if (
        !fieldsPart[1]
          .split(',')
          .map((x) => x.trim())
          .includes(field)
      )
        continue;
      const decl = line.trim().match(/^\w+\s+(\w+)/);
      if (decl) return decl[1];
    }
    return null;
  };

  const ownedNames = new Set(owned.map((m) => m.name));

  interface Constraint {
    model: string;
    fields: string[];
    byWorkspace: boolean;
    byParent: string | null;
  }

  const constraints: Constraint[] = [];
  for (const m of owned) {
    for (const line of m.body.split('\n')) {
      if (!/@unique|@@unique/.test(line)) continue;
      const composite = line.match(/@@unique\(\[([^\]]+)\]/);
      const fields = composite
        ? composite[1].split(',').map((x) => x.trim())
        : [(line.trim().match(/^(\w+)/) ?? [])[1]].filter(Boolean);
      if (fields.length === 0) continue;
      const parent =
        fields.map((f) => relationTarget(m.body, f)).find((t) => t !== null && ownedNames.has(t)) ??
        null;
      constraints.push({
        model: m.name,
        fields,
        byWorkspace: fields.includes('workspaceId'),
        byParent: parent,
      });
    }
  }

  const unsafe = constraints.filter((c) => !c.byWorkspace && c.byParent === null);

  it('found constraints to judge — otherwise this says nothing', () => {
    // Measured 2026-10-28: 35 constraints on owned models — 21 naming
    // workspaceId, 14 safe through a parent FK. Floors sit just under those,
    // so losing a whole route to a refactor fails here rather than passing
    // vacuously.
    expect(constraints.length).toBeGreaterThan(30);
    // Both routes are actually in use, so neither branch of the rule is dead.
    expect(constraints.filter((c) => c.byWorkspace).length).toBeGreaterThan(18);
    expect(constraints.filter((c) => !c.byWorkspace && c.byParent !== null).length).toBeGreaterThan(
      10,
    );
  });

  it('leaves none that a second workspace would collide on', () => {
    expect(unsafe.map((c) => `${c.model}(${c.fields.join('+')})`).sort()).toEqual([]);
  });
});
