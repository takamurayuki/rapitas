/**
 * workspace-tenancy schema coverage
 *
 * Tenancy is only as good as its weakest table. A model that owns its own rows
 * — no foreign key to another owned model — needs its own `workspaceId`, or
 * its rows belong to everyone. There is no way to see that by reading: the
 * schema is 97 models across 14 files, and the column is one line.
 *
 * So this derives the set of root models from the schema itself and asserts
 * every one of them carries the column. A root model added later without it
 * turns this red, which is the only thing that will notice.
 *
 * Stage 1 adds the column and nothing else, so these tests check structure,
 * not behaviour. The query-level guarantee arrives in stage 2 (one Prisma
 * client extension) and gets its own enumeration.
 */
import { describe, it, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const SCHEMA_DIR = join(dirname(dirname(import.meta.dir)), 'prisma', 'schema');

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

const models = loadModels();
const modelNames = new Set(models.map((m) => m.name));

/**
 * Models this one points at through an owning relation field (the side that
 * declares `fields:`). A model with any such parent inherits the parent's
 * workspace and needs no column of its own.
 */
function parentsOf(m: Model): string[] {
  const out = new Set<string>();
  for (const line of m.body.split('\n')) {
    if (!line.includes('@relation') || !line.includes('fields:')) continue;
    const t = /^\s*\w+\s+(\w+)\??/.exec(line);
    if (t && modelNames.has(t[1]) && t[1] !== m.name) out.add(t[1]);
  }
  return [...out];
}

/** Tenancy's own models are not tenanted by it. */
const EXEMPT = new Set(['User', 'UserSession', 'Workspace', 'WorkspaceMember']);

const roots = models.filter((m) => !EXEMPT.has(m.name) && parentsOf(m).length === 0);
const derived = models.filter((m) => !EXEMPT.has(m.name) && parentsOf(m).length > 0);

describe('every root model carries workspaceId', () => {
  it('found the roots at all — the check is not vacuous', () => {
    expect(models.length).toBeGreaterThan(80);
    expect(roots.length).toBeGreaterThan(40);
    expect(derived.length).toBeGreaterThan(40);
  });

  it('the root count is what stage 1 measured', () => {
    // Not a magic number: a change here means a model gained or lost its
    // parent relation, which changes whether it needs its own column.
    expect(roots.length).toBe(49);
  });

  it.each(roots.map((r) => [r.name, r] as const))('%s has workspaceId', (_name, root) => {
    expect(/^\s*workspaceId\s+Int\??/m.test(root.body)).toBe(true);
  });

  it('every root also indexes it', () => {
    const missing = roots
      .filter((r) => !/@@index\(\[workspaceId\]\)/.test(r.body))
      .map((r) => `${r.name} [${r.file}]`);
    expect(missing).toEqual([]);
  });

  it('derived models do NOT carry one — ownership comes from the parent', () => {
    const redundant = derived
      .filter((d) => /^\s*workspaceId\s/m.test(d.body))
      .map((d) => `${d.name} [${d.file}]`);
    expect(redundant).toEqual([]);
  });
});

describe('uniqueness constraints still unaware of the workspace', () => {
  // A column unique across the whole table stops the second workspace from
  // creating its own row. Stage 1 deliberately leaves these alone — changing
  // a unique index is a behaviour change — so the list is pinned instead.
  // When one is fixed, this goes red; update the list, which is the record
  // that it happened. Shrinking to [] is the goal.
  const PENDING = [
    'BacklogSchedule',
    'DetectionMissCase',
    'FavoriteDirectory',
    'GatePrecisionCase',
    'GitHubIntegration',
    'KnowledgeGraphNode',
    'MissSignatureSuggestion',
    'PaidLeaveBalance',
    'PrOutcome',
    'PrRiskMonthlyMetric',
    'PrRiskScore',
    'SearchMiss',
    'SystemPrompt',
    'ThemeAutoRun',
    'ThemeBacklogSchedule',
    'UsageBudgetThemeShare',
    'WeeklyReview',
    'WorkflowModeConfig',
  ];

  const offenders = roots
    .filter((r) => {
      const uniques = r.body.split('\n').filter((l) => /@unique|@@unique/.test(l));
      if (uniques.length === 0) return false;
      // Already workspace-aware when every unique mentions workspaceId.
      return !uniques.every((l) => l.includes('workspaceId'));
    })
    .map((r) => r.name)
    .sort();

  it('matches the recorded list exactly', () => {
    expect(offenders).toEqual(PENDING);
  });

  it('there is something to fix — otherwise this test means nothing', () => {
    expect(offenders.length).toBeGreaterThan(0);
  });
});
