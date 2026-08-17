/**
 * acceptance-self-check.test
 *
 * Unit tests for the advisory acceptance-criteria self-check: criteria
 * parsing/resolution, reference-token extraction, criterion↔diff matching,
 * the 614-type (unaddressed criterion) and 608-type (unrelated diff)
 * detections, and every fail-open branch. Pure functions — no I/O.
 */
import { describe, it, expect } from 'bun:test';
import {
  parseAcceptanceCriteria,
  extractCriteriaFromDescription,
  resolveAcceptanceCriteria,
  extractReferenceTokens,
  matchCriteriaToChanges,
  evaluateAcceptanceSelfCheck,
} from './acceptance-self-check';

describe('parseAcceptanceCriteria', () => {
  it('parses a JSON string array and drops empty entries', () => {
    expect(parseAcceptanceCriteria('["基準A", "基準B", "  "]')).toEqual(['基準A', '基準B']);
  });

  it('returns [] for null / undefined / empty / malformed / non-array input', () => {
    expect(parseAcceptanceCriteria(null)).toEqual([]);
    expect(parseAcceptanceCriteria(undefined)).toEqual([]);
    expect(parseAcceptanceCriteria('')).toEqual([]);
    expect(parseAcceptanceCriteria('not json')).toEqual([]);
    expect(parseAcceptanceCriteria('{"a":1}')).toEqual([]);
  });
});

describe('extractCriteriaFromDescription', () => {
  it('extracts bullets under a ## 受入基準 heading, stopping at the next heading', () => {
    const desc = [
      '## 要求',
      '- 何かの要求',
      '## 受入基準',
      '1. `foo.ts` を変更するテスト',
      '- [ ] チェックボックス付き基準',
      '',
      '## 測定',
      '- これは基準ではない',
    ].join('\n');
    expect(extractCriteriaFromDescription(desc)).toEqual([
      '`foo.ts` を変更するテスト',
      'チェックボックス付き基準',
    ]);
  });

  it('accepts 受け入れ基準 and Acceptance Criteria headings', () => {
    expect(extractCriteriaFromDescription('## 受け入れ基準\n- 基準X')).toEqual(['基準X']);
    expect(extractCriteriaFromDescription('### Acceptance Criteria\n- criterion Y')).toEqual([
      'criterion Y',
    ]);
  });

  it('returns [] when there is no criteria heading or no description', () => {
    expect(extractCriteriaFromDescription('## 概要\n- 何か')).toEqual([]);
    expect(extractCriteriaFromDescription(null)).toEqual([]);
    expect(extractCriteriaFromDescription(undefined)).toEqual([]);
  });
});

describe('resolveAcceptanceCriteria', () => {
  it('prefers the structured column over the description', () => {
    expect(
      resolveAcceptanceCriteria({
        acceptanceCriteria: '["列の基準"]',
        description: '## 受入基準\n- 説明の基準',
      }),
    ).toEqual(['列の基準']);
  });

  it('falls back to the description section when the column is empty/malformed', () => {
    expect(
      resolveAcceptanceCriteria({
        acceptanceCriteria: null,
        description: '## 受入基準\n- 説明の基準',
      }),
    ).toEqual(['説明の基準']);
    expect(
      resolveAcceptanceCriteria({
        acceptanceCriteria: 'broken',
        description: '## 受入基準\n- 説明の基準\n- 説明の基準',
      }),
    ).toEqual(['説明の基準']); // deduplicated
  });

  it('returns [] when both sources are empty', () => {
    expect(resolveAcceptanceCriteria({ acceptanceCriteria: null, description: null })).toEqual([]);
  });
});

describe('extractReferenceTokens', () => {
  it('extracts backtick path tokens, stripping line references', () => {
    expect(extractReferenceTokens('`services/foo/bar.ts:12` を修正')).toEqual([
      'services/foo/bar.ts',
    ]);
    expect(extractReferenceTokens('`automated-verifier.ts:799-821` 参照')).toEqual([
      'automated-verifier.ts',
    ]);
  });

  it('extracts only separator-bearing pieces from multi-word backtick tokens', () => {
    expect(extractReferenceTokens('`bun test services/a/b.test.ts` を実行')).toEqual([
      'services/a/b.test.ts',
    ]);
  });

  it('extracts bare tokens only with a separator or a known file extension', () => {
    expect(extractReferenceTokens('routes/workflow/handlers.ts と foo.ts を変更')).toEqual(
      expect.arrayContaining(['routes/workflow/handlers.ts', 'foo.ts']),
    );
    // Prose that merely LOOKS pathish must not become a token (false-NG source).
    expect(extractReferenceTokens('e.g. improve error handling in Node.js apps')).toEqual([]);
  });

  it('extracts directory tokens and normalizes backslashes', () => {
    expect(extractReferenceTokens('`services/intake/` 配下')).toEqual(['services/intake/']);
    expect(extractReferenceTokens('`services\\agents\\verification\\scope-check.ts`')).toEqual([
      'services/agents/verification/scope-check.ts',
    ]);
  });

  it('returns [] for prose without any path-like token', () => {
    expect(extractReferenceTokens('誤検出で正当な完了を止めないこと')).toEqual([]);
  });
});

describe('matchCriteriaToChanges', () => {
  it('marks token-less criteria as indeterminable and matched (fail-open)', () => {
    const [m] = matchCriteriaToChanges(['判定不能な入力で fail-open すること'], ['a.ts']);
    expect(m).toEqual({
      criterion: '判定不能な入力で fail-open すること',
      determinable: false,
      matched: true,
    });
  });

  it('matches via basename, path suffix, and directory prefix', () => {
    const changed = ['rapitas-backend/services/agents/verification/scope-check.ts'];
    const results = matchCriteriaToChanges(
      [
        '`scope-check.ts` を拡張する', // basename
        '`services/agents/verification/scope-check.ts` を拡張する', // path suffix
        '`services/agents/verification/` 配下に追加する', // dir prefix
        '`routes/tasks/task-router.ts` を変更する', // no match
      ],
      changed,
    );
    expect(results.map((r) => r.matched)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.determinable)).toEqual([true, true, true, true]);
  });
});

describe('evaluateAcceptanceSelfCheck', () => {
  // 受入基準1: a determinable criterion with no corresponding change is detected.
  it('fails when a determinable criterion matches no changed file (614-type)', () => {
    const check = evaluateAcceptanceSelfCheck({
      criteria: [
        '`services/workflow/completion-gate.ts` にガードを追加するテスト',
        '`routes/tasks/task-router.ts` の既存テストが green のまま',
      ],
      changedFiles: ['routes/tasks/task-router.ts', 'routes/tasks/task-router.test.ts'],
      taskText: 'タスク: `routes/tasks/task-router.ts` の改善と completion-gate の強化',
    });
    expect(check?.ok).toBe(false);
    expect(check?.name).toBe('acceptance');
    expect(check?.errorCount).toBe(1);
    expect(check?.details).toContain('completion-gate.ts');
    expect(check?.details).toContain('対応する変更が差分に見つかりません');
  });

  // 受入基準2: when every criterion is addressed the check passes (no false NG).
  it('passes with the criterion↔file mapping when all criteria are addressed', () => {
    const check = evaluateAcceptanceSelfCheck({
      criteria: [
        '`scope-check.ts` の照合を拡張するテスト',
        '判定不能な場合は fail-open で通すこと', // prose-only → indeterminable, not NG
      ],
      changedFiles: ['rapitas-backend/services/agents/verification/scope-check.ts'],
      taskText: 'scope 照合の改善',
    });
    expect(check?.ok).toBe(true);
    expect(check?.errorCount).toBe(0);
    // The mapping is kept in details so verify.md retains the correspondence.
    expect(check?.details).toContain('✓');
    expect(check?.details).toContain('scope-check.ts');
    expect(check?.details).toContain('機械判定の対象外');
  });

  // 受入基準4: a diff overlapping nothing the task mentions is flagged as unrelated.
  it('fails with the unrelated-diff wording on zero overlap (608-type)', () => {
    const check = evaluateAcceptanceSelfCheck({
      criteria: ['`services/intake/intake-gate.ts` の enrich を修正するテスト'],
      changedFiles: ['rapitas-frontend/src/components/ui/pagination/Pagination.tsx'],
      taskText: 'intake の enrich 品質を上げる（`services/intake/` 配下）',
    });
    expect(check?.ok).toBe(false);
    expect(check?.details).toContain('一切重なりません');
  });

  // 受入基準5: every non-judgeable input passes through as null (fail-open).
  it('returns null when criteria are empty', () => {
    expect(
      evaluateAcceptanceSelfCheck({ criteria: [], changedFiles: ['a.ts'], taskText: 'x' }),
    ).toBeNull();
  });

  it('returns null when the diff is empty', () => {
    expect(
      evaluateAcceptanceSelfCheck({ criteria: ['`a.ts` を直す'], changedFiles: [], taskText: 'x' }),
    ).toBeNull();
  });

  it('returns null when no criterion yields a reference token', () => {
    expect(
      evaluateAcceptanceSelfCheck({
        criteria: ['誤検出で正当な完了を止めないこと', '差し戻しを1回以内に抑える'],
        changedFiles: ['services/foo/bar.ts'],
        taskText: '精度改善タスク',
      }),
    ).toBeNull();
  });
});
