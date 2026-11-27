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
  test.each([
    [
      'ja',
      QUESTION_FORMAT_GUIDANCE_JA,
      [
        '完了条件を静的検証に変更',
        '方式Aの計画を方式B',
        'テストデータの作り方',
        '別のPRで修正済み',
      ],
    ],
    [
      'en',
      QUESTION_FORMAT_GUIDANCE_EN,
      [
        'Change a completion criterion to static verification',
        'Replace approach A with approach B',
        'Choose how to prepare test data',
        'fixed in another PR',
      ],
    ],
  ] as const)('%s で改訂と再開の4例に対応するフラグを示す', (_, text, examples) => {
    const impacts = ['criteria', 'approach', 'none', 'none'];
    const optionExamples = text.split('\n').filter((line) => line.includes('`{"planImpact":'));
    expect(optionExamples).toHaveLength(examples.length);
    for (const [index, example] of examples.entries()) {
      const line = optionExamples[index];
      expect(line).toContain(example);
      const option = line.match(/`(\{[^`]+\})`/)?.[1];
      expect(JSON.parse(option ?? '{}')).toEqual({
        planImpact: impacts[index],
        ...(index < 2 ? { planRevision: true } : {}),
      });
    }
  });
});
