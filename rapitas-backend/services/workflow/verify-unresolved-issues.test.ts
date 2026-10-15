/**
 * verify-unresolved-issues tests
 *
 * Covers extraction of the 残課題 section and the two-round comparison that
 * drives the "unchanged unresolved issues" repair cutoff.
 */
import { describe, expect, test } from 'bun:test';
import {
  extractUnresolvedIssues,
  compareUnresolvedIssues,
  buildUnchangedUnresolvedDetail,
} from './verify-unresolved-issues';

const doc = (body: string) =>
  `# verify\n\n## テスト結果\n- ✅ ok\n\n${body}\n\n## 使用知識\n- K-1\n`;

describe('extractUnresolvedIssues', () => {
  test('extracts bullets under 残課題 / フォローアップ headings', () => {
    const a = extractUnresolvedIssues(doc('## 残課題\n- 認証基盤未実装\n- RLS 実DB未実施'));
    expect(a).toEqual(['認証基盤未実装', 'rls 実db未実施']);
    expect(extractUnresolvedIssues(doc('### フォローアップ\n1. 追加調査'))).toEqual(['追加調査']);
    expect(extractUnresolvedIssues(doc('## Follow-ups\n* item A'))).toEqual(['item a']);
  });
  test('extracts table rows and skips header/separator', () => {
    const t = '## 残課題\n| 項目 | 状態 |\n| --- | --- |\n| 認証 | 未実装 |';
    expect(extractUnresolvedIssues(doc(t))).toEqual(['認証 未実装']);
  });
  test('empty declarations and missing section yield []', () => {
    expect(extractUnresolvedIssues(doc('## 残課題\n- なし'))).toEqual([]);
    expect(extractUnresolvedIssues(doc('## 残課題\nNone'))).toEqual([]);
    expect(extractUnresolvedIssues(doc('## 他\n- x'))).toEqual([]);
  });
  test('ignores repair-feedback blocks', () => {
    const c =
      '<!-- repair-feedback:start -->\n## 残課題\n- 古い指摘\n<!-- repair-feedback:end -->\n## 結果\n- ok';
    expect(extractUnresolvedIssues(c)).toEqual([]);
  });
  test('normalizes width and whitespace', () => {
    expect(extractUnresolvedIssues(doc('## 残課題\n- ＡＢＣ   未実装'))).toEqual(['abc 未実装']);
  });
});

describe('compareUnresolvedIssues', () => {
  const prev = doc('## 残課題\n- 認証基盤未実装\n- RLS 実DB未実施');
  test('same set (order-insensitive) is unchanged and lists items', () => {
    const cur = doc('## 残課題\n- RLS 実DB未実施\n- 認証基盤未実装');
    const r = compareUnresolvedIssues(prev, cur);
    expect(r.unchanged).toBe(true);
    expect(r.items).toContain('認証基盤未実装');
  });
  test('one changed item is not unchanged', () => {
    const cur = doc('## 残課題\n- 認証基盤未実装\n- RLS 実DB未実施（一部完了）');
    expect(compareUnresolvedIssues(prev, cur).unchanged).toBe(false);
  });
  test('added or removed item is not unchanged', () => {
    expect(compareUnresolvedIssues(prev, doc('## 残課題\n- 認証基盤未実装')).unchanged).toBe(false);
  });
  const A = 'authentication foundation is not implemented in this repository';
  const RLS = '本番データベースに対する行レベルセキュリティの実測が未実施';
  test('minor wording drift of the same item still counts as unchanged', () => {
    const r = compareUnresolvedIssues(doc(`## 残課題\n- ${A}`), doc(`## 残課題\n- ${A} yet`));
    expect(r.unchanged).toBe(true);
    expect(r.items).toHaveLength(1);
  });
  test('a substantively different item is not unchanged', () => {
    expect(
      compareUnresolvedIssues(doc(`## 残課題\n- ${A}`), doc(`## 残課題\n- ${RLS}`)).unchanged,
    ).toBe(false);
  });
  test('an added item is not unchanged even when the rest is similar', () => {
    expect(
      compareUnresolvedIssues(doc(`## 残課題\n- ${A}`), doc(`## 残課題\n- ${A}\n- ${RLS}`))
        .unchanged,
    ).toBe(false);
  });
  test('missing section or missing previous is not unchanged', () => {
    expect(compareUnresolvedIssues(prev, doc('## 他\n- x')).unchanged).toBe(false);
    expect(compareUnresolvedIssues(null, prev).unchanged).toBe(false);
    expect(
      compareUnresolvedIssues(doc('## 残課題\n- なし'), doc('## 残課題\n- なし')).unchanged,
    ).toBe(false);
  });
});

describe('buildUnchangedUnresolvedDetail', () => {
  test('names the unchanged items', () => {
    const d = buildUnchangedUnresolvedDetail(['認証基盤未実装']);
    expect(d).toContain('認証基盤未実装');
    expect(d).toContain('残課題');
  });
});
