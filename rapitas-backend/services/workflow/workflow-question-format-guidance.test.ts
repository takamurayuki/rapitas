import { describe, expect, test } from 'bun:test';
import {
  QUESTION_FORMAT_GUIDANCE_JA,
  QUESTION_FORMAT_GUIDANCE_EN,
} from './workflow-question-format-guidance';

describe('kind field guidance (task 965)', () => {
  test('ja guidance documents execution_continuation/completion_confirmation and existing mutatesGate text is preserved', () => {
    expect(QUESTION_FORMAT_GUIDANCE_JA).toContain('kind');
    expect(QUESTION_FORMAT_GUIDANCE_JA).toContain('execution_continuation');
    expect(QUESTION_FORMAT_GUIDANCE_JA).toContain('completion_confirmation');
    expect(QUESTION_FORMAT_GUIDANCE_JA).toContain('spec_change');
    expect(QUESTION_FORMAT_GUIDANCE_JA).toContain('mutatesGate');
    expect(QUESTION_FORMAT_GUIDANCE_JA).toContain('recommendedReason');
  });

  test('en guidance documents execution_continuation/completion_confirmation and existing mutatesGate text is preserved', () => {
    expect(QUESTION_FORMAT_GUIDANCE_EN).toContain('kind');
    expect(QUESTION_FORMAT_GUIDANCE_EN).toContain('execution_continuation');
    expect(QUESTION_FORMAT_GUIDANCE_EN).toContain('completion_confirmation');
    expect(QUESTION_FORMAT_GUIDANCE_EN).toContain('spec_change');
    expect(QUESTION_FORMAT_GUIDANCE_EN).toContain('mutatesGate');
    expect(QUESTION_FORMAT_GUIDANCE_EN).toContain('recommendedReason');
  });
});

// B6: the flag only works if the prompt teaches the agent to emit it. Without
// these lines the parser field is dead code — nothing would ever set it.
describe('requiresOperatorAction guidance (B6)', () => {
  test.each([
    ['ja', QUESTION_FORMAT_GUIDANCE_JA],
    ['en', QUESTION_FORMAT_GUIDANCE_EN],
  ])(
    '%s guidance documents requiresOperatorAction and that it is never auto-adopted',
    (_, text) => {
      expect(text).toContain('requiresOperatorAction: true');
      expect(text).toContain('#1215');
    },
  );
});

// task 1546: the over-flagging of planRevision (14 of 15 re-plans on 2026-11-25
// needed none) is a prompt problem — each language must teach both sides.
describe('planRevision when-to / when-not-to guidance (task 1546)', () => {
  test('日本語で改訂する例、再開する例、ファイル範囲の申告を示す', () => {
    const t = QUESTION_FORMAT_GUIDANCE_JA;
    expect(t).toContain('付ける例');
    expect(t).toContain('付けない例');
    expect(t).toContain('計画外のファイル');
    expect(t).toContain('保護パス');
    expect(t).toContain('planImpact');
    expect(t).toContain('完了条件を静的検証に変更');
    expect(t).toContain('方式Aの計画を方式B');
    expect(t).toContain('既存の方針内');
    expect(t).toContain('別のPRで修正済み');
    expect(t).toContain('"grantsFiles": ["src/example.ts"]');
    expect(t).toContain('運用者の署名付き承認');
    expect(t).toContain('自己承認');
    expect(t).toContain('旧形式の選択肢');
  });

  test('英語で改訂する例、再開する例、ファイル範囲の申告を示す', () => {
    const t = QUESTION_FORMAT_GUIDANCE_EN;
    expect(t).toContain('Set it for');
    expect(t).toContain('Do NOT set it for');
    expect(t).toContain('outside the plan');
    expect(t).toContain('protected paths');
    expect(t).toContain('planImpact');
    expect(t).toContain('changing a completion criterion to static verification');
    expect(t).toContain('replacing approach A with approach B');
    expect(t).toContain('within the approved approach');
    expect(t).toContain('fixed in another PR');
    expect(t).toContain('"grantsFiles": ["src/example.ts"]');
    expect(t).toMatch(/signed operator approval/i);
    expect(t).toContain('self-approval');
    expect(t).toContain('legacy options');
  });
});
