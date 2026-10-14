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
