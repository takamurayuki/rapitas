/**
 * verifier-seat テスト
 *
 * The verifier seat does not vote: it is shown only the disputed findings and
 * answers per finding whether the grounds hold.
 */
import { describe, test, expect } from 'bun:test';
import { buildVerifierPrompt, parseVerifierReply } from './verifier-seat';
import type { ReviewFinding } from './review-findings';

const disputed: ReviewFinding[] = [
  {
    severity: 'blocker',
    summary: 'null を渡すと落ちる',
    evidence: 'src/a.ts:10',
    repro: 'a(null) を呼ぶ',
    criterion: '受入基準1',
    gating: true,
    seatId: 'reviewer-1',
    juror: 'claude-opus',
  },
  { severity: 'major', summary: '境界値 0 が未処理', evidence: 'src/b.ts:3', gating: true },
];

describe('buildVerifierPrompt', () => {
  const prompt = buildVerifierPrompt({
    taskTitle: 'タスク',
    acceptanceCriteria: ['null を受け付ける'],
    planContent: '計画',
    diffText: '--- src/a.ts\n+code',
    disputed,
  });

  test('争点の指摘（要約・根拠・再現手順）を番号つきで渡す', () => {
    expect(prompt).toContain('1. [blocker] null を渡すと落ちる');
    expect(prompt).toContain('src/a.ts:10');
    expect(prompt).toContain('a(null) を呼ぶ');
    expect(prompt).toContain('2. [major] 境界値 0 が未処理');
  });

  test('誰が出した指摘か・他の席の合否は渡さない（投票させない）', () => {
    expect(prompt).not.toContain('reviewer-1');
    expect(prompt).not.toContain('claude-opus');
    expect(prompt).not.toMatch(/合格|不合格|"verdict"/);
  });
});

describe('parseVerifierReply', () => {
  test('3つの結果を読む（英語と日本語の表記）', () => {
    const r = parseVerifierReply(
      '```json\n{"results":[{"index":1,"status":"holds","note":"a.ts:10 で null が通る"},' +
        '{"index":2,"status":"成り立たない"}]}\n```',
      2,
    );
    expect(r).toEqual([
      { index: 1, status: 'holds', note: 'a.ts:10 で null が通る' },
      { index: 2, status: 'refuted' },
    ]);
  });

  test('判定できない・不明な値は undetermined', () => {
    const r = parseVerifierReply(
      '{"results":[{"index":1,"status":"判定できない"},{"index":2,"status":"maybe"}]}',
      2,
    );
    expect(r?.map((c) => c.status)).toEqual(['undetermined', 'undetermined']);
  });

  test('範囲外の index は捨てる。読めない返答は null（全件 undetermined 扱い）', () => {
    expect(parseVerifierReply('{"results":[{"index":9,"status":"holds"}]}', 2)).toEqual([]);
    expect(parseVerifierReply('判断できません', 2)).toBeNull();
    expect(parseVerifierReply('', 2)).toBeNull();
    expect(parseVerifierReply('{"results":"x"}', 2)).toBeNull();
  });
});
