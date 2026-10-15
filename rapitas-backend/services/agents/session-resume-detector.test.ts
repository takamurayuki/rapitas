/**
 * session-resume-detector tests
 *
 * Verifies resume-failure detection, including CLI context-overflow ("Prompt is too long").
 */
import { describe, test, expect } from 'bun:test';
import { isSessionResumeFailure } from './session-resume-detector';
import type { AgentExecutionResult } from './base-agent';

const fail = (errorMessage: string): AgentExecutionResult =>
  ({ success: false, output: '', errorMessage }) as AgentExecutionResult;

describe('isSessionResumeFailure', () => {
  test('detects a resumed session whose context overflowed (Prompt is too long)', () => {
    const msg =
      'Process exited with code 1\n\n【Session Resume Mode】Session ID: abc\n[System: compact_boundary]\nPrompt is too long';
    expect(isSessionResumeFailure(fail(msg), 'abc')).toBe(true);
  });

  test('does not fire without a resume session id', () => {
    expect(isSessionResumeFailure(fail('Prompt is too long'), null)).toBe(false);
  });

  test('does not fire on unrelated exit code 1', () => {
    expect(isSessionResumeFailure(fail('Process exited with code 1'), 'abc')).toBe(false);
  });

  test('still detects session expiry', () => {
    expect(isSessionResumeFailure(fail('No conversation found with session ID'), 'abc')).toBe(true);
  });
});
