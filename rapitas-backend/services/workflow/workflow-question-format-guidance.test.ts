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
