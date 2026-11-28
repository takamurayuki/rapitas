/**
 * miss-classify — which real gate a rejection came from (task 1602)
 *
 * The reason strings are copied from the callers of attemptVerifyRepair so a
 * rewording there turns this red instead of silently filing the wrong gate.
 */
import { describe, expect, test } from 'bun:test';
import {
  classifyRepairMiss,
  filesForMiss,
  gateFamilyOf,
  kindOfGate,
  summarizeReason,
} from './miss-classify';

describe('classifyRepairMiss', () => {
  test('a verify.md validator summary is the verify gate', () => {
    expect(classifyRepairMiss('verify.md explicitly marks the verification as failed.')).toEqual([
      { gate: 'verify', checkName: null },
    ]);
  });

  test('the HTTP / fallback jury reason is diff_review', () => {
    // verify-adversarial-review.ts / verify-fallback-jury-gate.ts → jury-repair-history.ts
    expect(classifyRepairMiss('差分レビュー不合格: 受入基準2 が未対応')).toEqual([
      { gate: 'diff_review', checkName: null },
    ]);
  });

  test('a human accepting a review hold is diff_review', () => {
    // review-hold-resolve.ts acceptedHoldReason
    const reason = '差分レビュー不合格（人間が指摘を受け入れ）: テストがありません';
    expect(classifyRepairMiss(reason)[0]!.gate).toBe('diff_review');
  });

  test('findings without the prefix still mark diff_review', () => {
    expect(classifyRepairMiss('jury fail', { findings: [{ summary: 'x' }] })[0]!.gate).toBe(
      'diff_review',
    );
  });

  test('the post-commit gate summary files one presave miss per failing check', () => {
    // verify-commit-pr-gate-blocked.ts gateReason
    const reason =
      '自動検証に失敗しました（自動検証: lint=NG(2) / typecheck=ok / secret=NG(1) / scope=NG(1)）。';
    expect(classifyRepairMiss(reason)).toEqual([
      { gate: 'presave:lint', checkName: 'lint' },
      { gate: 'presave:secret', checkName: 'secret' },
    ]);
  });

  test('a GitHub merge conflict is not a self-verify miss', () => {
    // verify-commit-pr.ts DIRTY bounce
    const reason = 'PR #12 は GitHub 上でまだ競合状態です（mergeStateStatus=DIRTY）。';
    expect(classifyRepairMiss(reason)).toEqual([]);
    expect(classifyRepairMiss('anything', { missGate: 'none' })).toEqual([]);
  });
});

describe('gate helpers', () => {
  test('machine gates are mechanical, reviewer gates are judgment', () => {
    expect(kindOfGate('ci:Lint Code')).toBe('mechanical');
    expect(kindOfGate('presave:secret')).toBe('mechanical');
    expect(kindOfGate('verify')).toBe('judgment');
    expect(kindOfGate('diff_review')).toBe('judgment');
    expect(gateFamilyOf('ci:Lint Code')).toBe('ci');
  });

  test('reason summaries are capped at 500 characters', () => {
    expect(summarizeReason('x'.repeat(900))).toHaveLength(500);
    expect(summarizeReason('  short  ')).toBe('short');
  });

  test('files come from the reason and findings, else every changed file', () => {
    const changed = ['rapitas-backend/a.ts', 'rapitas-backend/b.ts'];
    expect(filesForMiss('broke rapitas-backend/b.ts:12', [], changed)).toEqual([
      'rapitas-backend/b.ts',
    ]);
    expect(filesForMiss('x', [{ evidence: 'a.ts:3' }], changed)).toEqual(['rapitas-backend/a.ts']);
    expect(filesForMiss('no path', [], changed)).toEqual(changed);
    expect(filesForMiss('no path', [], [], ['given.ts'])).toEqual(['given.ts']);
  });
});
