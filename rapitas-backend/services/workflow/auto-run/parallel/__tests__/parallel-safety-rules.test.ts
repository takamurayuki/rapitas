/**
 * parallel-safety-rules.test
 *
 * Task 1552: table tests for the pair rules that keep two tasks from running
 * side by side — each refusal reason at least once, the pairs that pass, the
 * dependency text notation (6 that count, 4 that do not) and the glob rules.
 */
import { describe, test, expect } from 'bun:test';
import {
  CONFLICT_PRONE_FILE_RULES,
  collectPlanFiles,
  conflictProneHits,
  extractDependencyRefs,
  globToSuffixRegex,
  judgePair,
  type PairContext,
  type PairSide,
} from '../parallel-safety-rules';

const plan = (...files: string[]) =>
  `## 変更予定ファイル\n${files.map((f) => `- \`${f}\``).join('\n')}`;
const side = (
  taskId: number,
  files: string[] | null,
  description: string | null = null,
): PairSide => ({
  taskId,
  plan: files ? plan(...files) : null,
  description,
});
const ctx = (over: Partial<PairContext> = {}): PairContext => ({
  requirePlans: true,
  tableLinked: false,
  incompleteTaskIds: new Set(),
  ...over,
});

const A = side(10, ['rapitas-backend/services/alpha/a.ts']);

describe('judgePair — refusal reasons (same theme)', () => {
  const rows: Array<{
    name: string;
    cand: PairSide;
    c?: Partial<PairContext>;
    reason: string | null;
  }> = [
    { name: 'disjoint files', cand: side(20, ['rapitas-frontend/src/beta/b.tsx']), reason: null },
    {
      name: 'one shared file (repo vs package relative)',
      cand: side(20, ['services/alpha/a.ts', 'rapitas-frontend/src/x.tsx']),
      reason: 'file_overlap',
    },
    { name: 'candidate has no plan', cand: side(20, null), reason: 'candidate_plan_missing' },
    {
      name: 'plan without any concrete file',
      cand: { taskId: 20, plan: '方針だけで、ファイル名は書いていない', description: null },
      reason: 'candidate_plan_missing',
    },
    {
      name: 'same folder, different file',
      cand: side(20, ['rapitas-backend/services/alpha/other.ts']),
      reason: 'same_directory',
    },
    // NOTE: 2026-11-27 — a pair-scoped conflict-prone file (schema, messages,
    // route barrel, baselines) on ONE side no longer refuses: only two tasks
    // that both touch the same kind collide. See the pair-scope table below.
    {
      name: 'pair-scoped file on one side only: messages/ja.json',
      cand: side(20, ['rapitas-frontend/messages/ja.json']),
      reason: null,
    },
    {
      name: 'pair-scoped file on one side only: generated route barrel',
      cand: side(20, ['rapitas-backend/routes/agents/index.ts']),
      reason: null,
    },
    {
      name: 'pair-scoped file on one side only: prisma schema',
      cand: side(20, ['rapitas-backend/prisma/schema/workflow.prisma']),
      reason: null,
    },
    {
      name: 'conflict-prone (any side): lockfile',
      cand: side(20, ['pnpm-lock.yaml']),
      reason: 'conflict_prone_file',
    },
    {
      name: 'dependency table link',
      cand: side(20, ['rapitas-frontend/src/beta/b.tsx']),
      c: { tableLinked: true },
      reason: 'dependency_link',
    },
    {
      name: 'dependency in text naming the running task',
      cand: side(20, ['rapitas-frontend/src/beta/b.tsx'], 'タスク10に依存する'),
      reason: 'dependency_text',
    },
    {
      name: 'dependency in text naming an unfinished task',
      cand: side(20, ['rapitas-frontend/src/beta/b.tsx'], '#999 の後に着手'),
      c: { incompleteTaskIds: new Set([999]) },
      reason: 'dependency_text',
    },
    {
      name: 'dependency on a finished task is fine',
      cand: side(20, ['rapitas-frontend/src/beta/b.tsx'], '#999 の後に着手'),
      reason: null,
    },
    {
      name: 'import relation reported by the caller',
      cand: side(20, ['rapitas-frontend/src/beta/b.tsx']),
      c: { importRelated: true },
      reason: 'import_relation',
    },
  ];
  for (const r of rows) {
    test(`${r.name} → ${r.reason ?? 'ok'}`, () => {
      const verdict = judgePair(r.cand, A, ctx(r.c));
      if (r.reason === null) expect(verdict).toEqual({ ok: true });
      else expect(verdict).toMatchObject({ ok: false, reason: r.reason });
    });
  }

  test('the running task without a plan refuses too', () => {
    expect(judgePair(side(20, ['x/y/z.ts']), side(10, null), ctx())).toMatchObject({
      reason: 'active_plan_missing',
    });
  });

  test('an any-scoped conflict-prone file on the RUNNING side also refuses', () => {
    const running = side(10, ['rapitas-frontend/tsconfig.json']);
    expect(judgePair(side(20, ['a/b/c.ts']), running, ctx())).toMatchObject({
      reason: 'conflict_prone_file',
    });
  });
});

// 2026-11-27 user request: a task that does not touch the schema may run next
// to one that does. Pair-scoped kinds refuse only when BOTH sides touch the
// same kind; any-scoped kinds (dependencies, shared config) refuse from one side.
describe('judgePair — conflict-prone scope', () => {
  const rows: Array<{ name: string; cand: string[]; act: string[]; reason: string | null }> = [
    {
      name: 'schema vs unrelated file',
      cand: ['rapitas-backend/prisma/schema/core.prisma'],
      act: ['rapitas-backend/services/alpha/a.ts'],
      reason: null,
    },
    {
      name: 'schema vs schema (different files)',
      cand: ['rapitas-backend/prisma/schema/core.prisma'],
      act: ['rapitas-backend/prisma/schema/system.prisma'],
      reason: 'conflict_prone_file',
    },
    {
      name: 'schema vs generated init SQL (same kind)',
      cand: ['rapitas-backend/prisma/schema/core.prisma'],
      act: ['rapitas-backend/src/generated/sqlite-init-sql.ts'],
      reason: 'conflict_prone_file',
    },
    {
      name: 'messages/ja.json vs messages/en.json (same kind)',
      cand: ['rapitas-frontend/messages/ja.json'],
      act: ['rapitas-frontend/messages/en.json'],
      reason: 'conflict_prone_file',
    },
    {
      name: 'schema vs messages (different kinds)',
      cand: ['rapitas-backend/prisma/schema/core.prisma'],
      act: ['rapitas-frontend/messages/ja.json'],
      reason: null,
    },
    {
      name: 'package.json on one side refuses',
      cand: ['rapitas-backend/package.json'],
      act: ['rapitas-frontend/src/beta/b.tsx'],
      reason: 'conflict_prone_file',
    },
    {
      name: 'eslint config on the running side refuses',
      cand: ['rapitas-frontend/src/beta/b.tsx'],
      act: ['rapitas-frontend/eslint.config.mjs'],
      reason: 'conflict_prone_file',
    },
  ];
  for (const r of rows) {
    test(`${r.name} → ${r.reason ?? 'ok'}`, () => {
      const verdict = judgePair(side(20, r.cand), side(10, r.act), ctx());
      if (r.reason === null) expect(verdict).toEqual({ ok: true });
      else expect(verdict).toMatchObject({ ok: false, reason: r.reason });
    });
  }

  test('the overlapping file is named in the detail', () => {
    const v = judgePair(side(20, ['rapitas-backend/services/alpha/a.ts']), A, ctx());
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.detail).toContain('services/alpha/a.ts');
  });
});

describe('judgePair — another theme (requirePlans false)', () => {
  test('a missing plan passes the file rules (fail-open)', () => {
    expect(judgePair(side(20, null), A, ctx({ requirePlans: false }))).toEqual({ ok: true });
  });
  test('dependency rules still apply', () => {
    expect(
      judgePair(side(20, null, 'depends on #10'), A, ctx({ requirePlans: false })),
    ).toMatchObject({
      reason: 'dependency_text',
    });
  });
  test('file rules apply when both have plans', () => {
    expect(
      judgePair(side(20, ['rapitas-backend/services/alpha/a.ts']), A, ctx({ requirePlans: false })),
    ).toMatchObject({ reason: 'file_overlap' });
  });
});

describe('extractDependencyRefs', () => {
  const counts: Array<[string, number[]]> = [
    ['タスク1543に依存', [1543]],
    ['#1543 の後に着手する', [1543]],
    ['1543番の完了後', [1543]],
    ['タスク 1543 がマージされてから始める', [1543]],
    ['depends on #1543', [1543]],
    ['Blocked by task #1543 and after #77', [1543, 77]],
  ];
  const ignored = [
    '#1543 で追加した設定を使う',
    'PR #12 を参照',
    '2026-11-26 の後に確認',
    'self: タスク1552に依存',
  ];
  for (const [text, ids] of counts)
    test(`counts: ${text}`, () => expect(extractDependencyRefs(text, 1552)).toEqual(ids));
  for (const text of ignored)
    test(`ignores: ${text}`, () => expect(extractDependencyRefs(text, 1552)).toEqual([]));
});

describe('collectPlanFiles and globs', () => {
  test('declaration globs become patterns; shallow ones are ignored', () => {
    const set = collectPlanFiles(
      '```json:plan-declaration\n{"version":1,"files":["rapitas-backend/services/workflow/auto-run/**","rapitas-backend/services/**"],"commands":[],"externalHosts":[]}\n```',
    );
    expect(set.patterns).toEqual(['rapitas-backend/services/workflow/auto-run/**']);
    expect(set.ignoredPatterns).toEqual(['rapitas-backend/services/**']);
  });

  test('a declared directory glob overlaps a concrete file below it', () => {
    const decl =
      '```json:plan-declaration\n{"version":1,"files":["rapitas-backend/services/workflow/auto-run/**"],"commands":[],"externalHosts":[]}\n```';
    const v = judgePair(
      side(20, ['services/workflow/auto-run/x.ts']),
      { taskId: 10, plan: decl, description: null },
      ctx(),
    );
    expect(v).toMatchObject({ reason: 'file_overlap' });
  });

  test('glob matching: * stays in a segment, ** spans depth, root files hit **/', () => {
    expect(
      globToSuffixRegex('rapitas-backend/routes/*/index.ts').test(
        'rapitas-backend/routes/a/index.ts',
      ),
    ).toBe(true);
    expect(
      globToSuffixRegex('rapitas-backend/routes/*/index.ts').test(
        'rapitas-backend/routes/a/b/index.ts',
      ),
    ).toBe(false);
    expect(globToSuffixRegex('**/package.json').test('package.json')).toBe(true);
    expect(globToSuffixRegex('**/tsconfig*.json').test('rapitas-frontend/tsconfig.base.json')).toBe(
      true,
    );
  });

  test('every conflict-prone rule has a reason and hits a matching path', () => {
    for (const rule of CONFLICT_PRONE_FILE_RULES) expect(rule.reason.length).toBeGreaterThan(0);
    expect(
      conflictProneHits({
        files: ['.baselines/file-size.json'],
        patterns: [],
        ignoredPatterns: [],
      }),
    ).toHaveLength(1);
    expect(
      conflictProneHits({ files: ['routes/agents/index.ts'], patterns: [], ignoredPatterns: [] }),
    ).toHaveLength(1);
    expect(
      conflictProneHits({
        files: ['rapitas-backend/services/a.ts'],
        patterns: [],
        ignoredPatterns: [],
      }),
    ).toEqual([]);
  });
});
