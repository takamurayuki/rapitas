/**
 * parallel-safety-rules.scope.test
 *
 * Conflict-prone scope (2026-11-27 user request): pair-scoped kinds refuse
 * only when both sides touch the same kind; any-scoped kinds refuse from one
 * side. Split out of parallel-safety-rules.test.ts to keep both under 300 lines.
 */
import { describe, test, expect } from 'bun:test';
import { judgePair, type PairContext, type PairSide } from '../parallel-safety-rules';

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
    // 2026-11-27: .env.example on one side refused every candidate; it only lists
    // variables and does not change how the other task's code behaves.
    {
      name: '.env.example on one side only',
      cand: ['rapitas-frontend/src/beta/b.tsx'],
      act: ['.env.example'],
      reason: null,
    },
    {
      name: '.env.example on both sides',
      cand: ['rapitas-backend/.env.example'],
      act: ['.env.example'],
      reason: 'conflict_prone_file',
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
