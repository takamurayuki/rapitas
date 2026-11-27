/**
 * plan-file-tokens.test
 *
 * 2026-11-27: plan prose like `mock.module` was read as a file named
 * "mock.module", so every pair of plans that mention it refused each other
 * (5 of 8 parallel refusals that afternoon). Only paths and real file names
 * may count.
 */
import { describe, expect, test } from 'bun:test';
import { collectPlanFiles, judgePair, type PairSide } from '../parallel-safety-rules';
import { isLikelyFile } from '../plan-file-tokens';

const plan = (...files: string[]) =>
  `## 変更予定ファイル\n${files.map((f) => `- \`${f}\``).join('\n')}`;
const side = (taskId: number, files: string[]): PairSide => ({
  taskId,
  plan: plan(...files),
  description: null,
});
const ctx = { requirePlans: true, tableLinked: false, incompleteTaskIds: new Set<number>() };

describe('plan file tokens', () => {
  test('folders and known extensions count; dotted prose does not', () => {
    expect(isLikelyFile('rapitas-backend/a.ts')).toBe(true);
    expect(isLikelyFile('package.json')).toBe(true);
    expect(isLikelyFile('.env.example')).toBe(true);
    expect(isLikelyFile('mock.module')).toBe(false);
    expect(isLikelyFile('process.env')).toBe(false);
  });

  test('collectPlanFiles drops dotted words that are not file names', () => {
    const set = collectPlanFiles(
      plan('rapitas-backend/services/alpha/a.ts', 'mock.module', 'process.env', 'package.json'),
    );
    expect(set.files).toContain('rapitas-backend/services/alpha/a.ts');
    expect(set.files).toContain('package.json');
    expect(set.files).not.toContain('mock.module');
    expect(set.files).not.toContain('process.env');
  });

  test('two plans that both mention mock.module do not overlap', () => {
    const a = side(10, ['rapitas-backend/services/alpha/a.ts', 'mock.module']);
    const b = side(20, ['rapitas-frontend/src/beta/b.tsx', 'mock.module']);
    expect(judgePair(b, a, ctx)).toEqual({ ok: true });
  });
});
