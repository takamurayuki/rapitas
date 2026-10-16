/**
 * resume-condition 純粋ロジックのテスト
 *
 * 受入1（質問は1問のみ）・受入3（質問IDと24h期限）・受入4（失効）・受入5（再発時の提案）。
 */
import { describe, test, expect } from 'bun:test';
import {
  RESUMABLE_REASONS,
  RESUME_CONDITION_APPROVED_CAUSE,
  RESUME_CONDITION_REVOKED_CAUSE,
  RESUME_CONDITION_TTL_MS,
  buildResumeQuestion,
  evaluateResumeCondition,
  findSuggestion,
  parseResumeAnswer,
  resolveResumeReleases,
  type ResumeEventRow,
} from '../../services/workflow/resume-condition';

const NOW = 1_800_000_000_000;
const ALL_REASONS = [
  'awaiting_question',
  'verification_unverifiable',
  'verify_no_convergence',
  'manual_correction_pending',
  'abandoned_old',
  'verify_repair_exhausted',
  'retry_cap_exhausted',
  'pr_recovery_exhausted',
];

function approvedRow(
  id: number,
  at: number,
  over: Record<string, unknown> = {},
  reason = 'retry_cap_exhausted',
): ResumeEventRow {
  return {
    id,
    cause: RESUME_CONDITION_APPROVED_CAUSE,
    createdAt: new Date(at),
    metadata: JSON.stringify({
      questionId: `rq-1-${reason}-${id}`,
      reason,
      spec: { kind: 'boolean', value: true },
      approvedAt: at,
      expiresAt: at + RESUME_CONDITION_TTL_MS,
      snapshot: { status: 'blocked', workflowStatus: 'draft', stopMarkerId: 5 },
      ...over,
    }),
  };
}
const CTX = { status: 'blocked', workflowStatus: 'draft', stopMarkerId: 5 };

describe('buildResumeQuestion（受入1）', () => {
  test('解除可能な4理由は質問がちょうど1問', () => {
    for (const r of RESUMABLE_REASONS) {
      const q = buildResumeQuestion(r);
      expect(q.kind).toBe('question');
      expect(q).toHaveProperty('text');
    }
  });
  test('残り4理由は質問0問（not_resumable）', () => {
    const rest = ALL_REASONS.filter((r) => !(RESUMABLE_REASONS as readonly string[]).includes(r));
    expect(rest).toHaveLength(4);
    for (const r of rest) expect(buildResumeQuestion(r).kind).toBe('not_resumable');
  });
});

describe('parseResumeAnswer（自由記述を条件にしない）', () => {
  const exists = (p: string) => p === 'src/fixed.ts';
  test('boolean は true のみ許可', () => {
    expect(parseResumeAnswer('retry_cap_exhausted', true, exists).ok).toBe(true);
    expect(parseResumeAnswer('retry_cap_exhausted', false, exists).ok).toBe(false);
    expect(parseResumeAnswer('pr_recovery_exhausted', 'yes', exists).ok).toBe(false);
  });
  test('choice は許可リスト内のみ', () => {
    const ok = parseResumeAnswer('verify_repair_exhausted', 'scope_reduced', exists);
    expect(ok).toEqual({ ok: true, spec: { kind: 'choice', value: 'scope_reduced' } });
    expect(parseResumeAnswer('verify_repair_exhausted', 'やり直して', exists).ok).toBe(false);
  });
  test('file_path は相対・存在するもののみ（.. 絶対パス ドライブ指定は拒否）', () => {
    expect(parseResumeAnswer('verify_no_convergence', 'src/fixed.ts', exists).ok).toBe(true);
    for (const bad of ['../x.ts', 'a/../../x', '/etc/passwd', 'C:\\x.ts', 'src/missing.ts', '']) {
      expect(parseResumeAnswer('verify_no_convergence', bad, exists).ok).toBe(false);
    }
  });
});

describe('evaluateResumeCondition（受入3・4）', () => {
  const T0 = NOW;
  test('質問IDと承認から24時間後の期限が保存される', () => {
    const r = evaluateResumeCondition([approvedRow(9, T0)], CTX, T0 + 1);
    expect(r.state).toBe('active');
    if (r.state !== 'active') throw new Error('unreachable');
    expect(r.condition.questionId).toBe('rq-1-retry_cap_exhausted-9');
    expect(r.condition.expiresAt - r.condition.approvedAt).toBe(24 * 60 * 60_000);
  });
  test('24時間-1msは有効、24時間ちょうどは失効', () => {
    const rows = [approvedRow(9, T0)];
    expect(evaluateResumeCondition(rows, CTX, T0 + RESUME_CONDITION_TTL_MS - 1).state).toBe(
      'active',
    );
    expect(evaluateResumeCondition(rows, CTX, T0 + RESUME_CONDITION_TTL_MS).state).toBe('expired');
  });
  test('status / workflowStatus / 停止マーカーのいずれの変化でも失効', () => {
    const rows = [approvedRow(9, T0)];
    for (const ctx of [
      { ...CTX, status: 'todo' },
      { ...CTX, workflowStatus: 'verify_done' },
      { ...CTX, stopMarkerId: 6 },
    ]) {
      expect(evaluateResumeCondition(rows, ctx, T0 + 1).state).toBe('state_changed');
    }
  });
  test('revoke 行があれば revoked、承認なしは none', () => {
    const revoke: ResumeEventRow = {
      id: 10,
      cause: RESUME_CONDITION_REVOKED_CAUSE,
      createdAt: new Date(T0 + 5),
      metadata: JSON.stringify({ questionId: 'rq-1-retry_cap_exhausted-9' }),
    };
    expect(evaluateResumeCondition([approvedRow(9, T0), revoke], CTX, T0 + 6).state).toBe(
      'revoked',
    );
    expect(evaluateResumeCondition([], CTX, T0).state).toBe('none');
  });
});

describe('resolveResumeReleases', () => {
  test('有効な条件の理由だけを解除し、失効後は空', () => {
    const rows = [approvedRow(9, NOW)];
    expect(resolveResumeReleases(evaluateResumeCondition(rows, CTX, NOW + 1))).toEqual([
      'retry_cap_exhausted',
    ]);
    expect(
      resolveResumeReleases(evaluateResumeCondition(rows, CTX, NOW + RESUME_CONDITION_TTL_MS)),
    ).toEqual([]);
  });
  test('許可リスト外の理由を持つ行は無効扱い（解除しない）', () => {
    const rows = [approvedRow(9, NOW, {}, 'awaiting_question')];
    expect(resolveResumeReleases(evaluateResumeCondition(rows, CTX, NOW + 1))).toEqual([]);
  });
});

describe('findSuggestion（受入5）', () => {
  test('同一理由の過去回答を返し、失効後でも提案は残る', () => {
    const rows = [approvedRow(3, NOW - 3 * RESUME_CONDITION_TTL_MS)];
    expect(findSuggestion(rows, 'retry_cap_exhausted', 'rq-1-retry_cap_exhausted-20')).toEqual({
      kind: 'boolean',
      value: true,
    });
  });
  test('別理由・現在の質問自身・履歴なしは提案しない', () => {
    const rows = [approvedRow(3, NOW)];
    expect(findSuggestion(rows, 'pr_recovery_exhausted')).toBeNull();
    expect(findSuggestion(rows, 'retry_cap_exhausted', 'rq-1-retry_cap_exhausted-3')).toBeNull();
    expect(findSuggestion([], 'retry_cap_exhausted')).toBeNull();
  });
});
