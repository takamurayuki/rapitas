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

/** Auth and tenancy's own models: scoping these would break logging in. */
const EXEMPT = new Set(['User', 'UserSession', 'Workspace', 'WorkspaceMember']);

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

describe('uniqueness constraints still unaware of the workspace', () => {
  // A column unique across the whole table stops the second workspace from
  // creating its own row. Changing a unique index is a behaviour change, so
  // the list is pinned instead of fixed. When one is fixed, this goes red;
  // update the list, which is the record that it happened. Shrinking to [] is
  // the goal.
  const PENDING = [
    'AgentExecutionConfig',
    'BacklogSchedule',
    'CommentLink',
    'DetectionMissCase',
    'DeveloperModeConfig',
    'FavoriteDirectory',
    'GatePrecisionCase',
    'GitHubIntegration',
    'GitHubIssue',
    'GitHubPullRequest',
    'KnowledgeContradiction',
    'KnowledgeGraphEdge',
    'KnowledgeGraphNode',
    'MissSignatureSuggestion',
    'NoteTaskLink',
    'PaidLeaveBalance',
    'PrOutcome',
    'PrRiskMonthlyMetric',
    'PrRiskScore',
    'RequirementReviewRetryRequest',
    'SearchMiss',
    'SystemPrompt',
    'TaskAnalysisConfig',
    'TaskLabel',
    'TaskPattern',
    'ThemeAutoRun',
    'ThemeBacklogSchedule',
    'UsageBudgetThemeShare',
    'UserBehaviorSummary',
    'WeeklyReview',
    'WorkflowFile',
    'WorkflowModeConfig',
    'WorkflowQueueItem',
    'WorkflowRoleConfig',
  ];

  const offenders = owned
    .filter((m) => {
      const uniques = m.body.split('\n').filter((l) => /@unique|@@unique/.test(l));
      if (uniques.length === 0) return false;
      // Already workspace-aware when every unique mentions workspaceId.
      return !uniques.every((l) => l.includes('workspaceId'));
    })
    .map((m) => m.name)
    .sort();

  it('matches the recorded list exactly', () => {
    expect(offenders).toEqual(PENDING);
  });

  it('there is something to fix — otherwise this test means nothing', () => {
    expect(offenders.length).toBeGreaterThan(0);
  });
});
