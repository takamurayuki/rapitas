/**
 * adapter-result-converter.test
 *
 * Unit tests for mapping legacy ClaudeCodeAgent results into the abstraction
 * layer's AgentExecutionResult shape, plus the cancelled/error result builders.
 */
import { describe, it, expect } from 'bun:test';
import {
  mapQuestionType,
  convertLegacyResult,
  createCancelledResult,
  createErrorResult,
  wrapError,
} from './adapter-result-converter';
import { AgentError } from '../interfaces';
import type { AgentExecutionContext } from '../types';
import type { AgentExecutionResult as LegacyExecutionResult } from '../../base-agent';

function makeContext(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return { executionId: 'exec-1', workingDirectory: '/tmp/work', ...overrides };
}

function makeLegacyResult(overrides: Partial<LegacyExecutionResult> = {}): LegacyExecutionResult {
  return { success: true, output: 'done', ...overrides };
}

// ──────────────────────────────────────────────────────────────────────────────
// mapQuestionType
// ──────────────────────────────────────────────────────────────────────────────

describe('mapQuestionType', () => {
  it.each([
    ['clarification', 'clarification'],
    ['confirmation', 'confirmation'],
    ['selection', 'selection'],
    ['tool_call', 'input'],
    ['anything-else', 'input'],
  ] as const)('maps "%s" to "%s"', (legacyType, expected) => {
    expect(mapQuestionType(legacyType)).toBe(expected);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// convertLegacyResult
// ──────────────────────────────────────────────────────────────────────────────

describe('convertLegacyResult', () => {
  it('maps a successful, non-waiting result to state=completed', () => {
    const result = convertLegacyResult(
      makeLegacyResult({ success: true }),
      new Date(),
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(result.state).toBe('completed');
    expect(result.pendingQuestion).toBeUndefined();
  });

  it('maps a failed, non-waiting result to state=failed', () => {
    const result = convertLegacyResult(
      makeLegacyResult({ success: false, errorMessage: 'nope' }),
      new Date(),
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toBe('nope');
  });

  it('maps a waitingForInput result to state=waiting_for_input regardless of success', () => {
    const result = convertLegacyResult(
      makeLegacyResult({ success: false, waitingForInput: true }),
      new Date(),
      makeContext(),
    );
    expect(result.state).toBe('waiting_for_input');
  });

  it('builds a pendingQuestion only when waitingForInput and question are both set', () => {
    const withQuestion = convertLegacyResult(
      makeLegacyResult({
        waitingForInput: true,
        question: 'Continue?',
        questionType: 'confirmation',
      }),
      new Date(),
      makeContext(),
    );
    expect(withQuestion.pendingQuestion?.text).toBe('Continue?');
    expect(withQuestion.pendingQuestion?.category).toBe('confirmation');

    const waitingNoQuestion = convertLegacyResult(
      makeLegacyResult({ waitingForInput: true }),
      new Date(),
      makeContext(),
    );
    expect(waitingNoQuestion.pendingQuestion).toBeUndefined();

    const questionNoWaiting = convertLegacyResult(
      makeLegacyResult({ waitingForInput: false, question: 'Continue?' }),
      new Date(),
      makeContext(),
    );
    expect(questionNoWaiting.pendingQuestion).toBeUndefined();
  });

  it('defaults the pending question category to "input" when questionType is missing', () => {
    const result = convertLegacyResult(
      makeLegacyResult({ waitingForInput: true, question: 'Continue?' }),
      new Date(),
      makeContext(),
    );
    expect(result.pendingQuestion?.category).toBe('input');
  });

  it('uses questionKey.question_id when present, else a generated fallback', () => {
    const withKey = convertLegacyResult(
      makeLegacyResult({
        waitingForInput: true,
        question: 'Continue?',
        questionKey: {
          status: 'awaiting_user_input',
          question_id: 'qk-42',
          question_type: 'confirmation',
          requires_response: true,
        },
      }),
      new Date(),
      makeContext(),
    );
    expect(withKey.pendingQuestion?.questionId).toBe('qk-42');

    const withoutKey = convertLegacyResult(
      makeLegacyResult({ waitingForInput: true, question: 'Continue?' }),
      new Date(),
      makeContext(),
    );
    expect(withoutKey.pendingQuestion?.questionId).toMatch(/^q-\d+$/);
  });

  it('maps questionDetails options with value defaulted to the label', () => {
    const result = convertLegacyResult(
      makeLegacyResult({
        waitingForInput: true,
        question: 'Pick one',
        questionDetails: {
          options: [{ label: 'A', description: 'first' }, { label: 'B' }],
          multiSelect: true,
        },
      }),
      new Date(),
      makeContext(),
    );
    expect(result.pendingQuestion?.options).toEqual([
      { label: 'A', value: 'A', description: 'first' },
      { label: 'B', value: 'B', description: undefined },
    ]);
    expect(result.pendingQuestion?.multiSelect).toBe(true);
  });

  it('maps artifacts and commits through with the same field values', () => {
    const result = convertLegacyResult(
      makeLegacyResult({
        artifacts: [{ type: 'file', name: 'a.txt', content: 'x', path: '/a.txt' }],
        commits: [
          {
            hash: 'h1',
            message: 'm',
            branch: 'b',
            filesChanged: 1,
            additions: 2,
            deletions: 0,
          },
        ],
      }),
      new Date(),
      makeContext(),
    );
    expect(result.artifacts).toEqual([
      { type: 'file', name: 'a.txt', content: 'x', path: '/a.txt' },
    ]);
    expect(result.commits).toEqual([
      { hash: 'h1', message: 'm', branch: 'b', filesChanged: 1, additions: 2, deletions: 0 },
    ]);
  });

  it('leaves artifacts/commits undefined when the legacy result has none', () => {
    const result = convertLegacyResult(makeLegacyResult(), new Date(), makeContext());
    expect(result.artifacts).toBeUndefined();
    expect(result.commits).toBeUndefined();
  });

  it('computes metrics.durationMs from the given startTime', async () => {
    const startTime = new Date(Date.now() - 50);
    const result = convertLegacyResult(makeLegacyResult(), startTime, makeContext());
    expect(result.metrics?.startTime).toBe(startTime);
    expect(result.metrics?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('carries claudeSessionId through as sessionId', () => {
    const result = convertLegacyResult(
      makeLegacyResult({ claudeSessionId: 'sess-99' }),
      new Date(),
      makeContext(),
    );
    expect(result.sessionId).toBe('sess-99');
  });

  it('always returns an empty debugInfo.logs array', () => {
    const result = convertLegacyResult(makeLegacyResult(), new Date(), makeContext());
    expect(result.debugInfo).toEqual({ logs: [] });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// createCancelledResult
// ──────────────────────────────────────────────────────────────────────────────

describe('createCancelledResult', () => {
  it('builds a failed/cancelled result carrying the reason as errorMessage', () => {
    const result = createCancelledResult(makeContext(), 'user aborted');
    expect(result.success).toBe(false);
    expect(result.state).toBe('cancelled');
    expect(result.output).toBe('');
    expect(result.errorMessage).toBe('user aborted');
    expect(result.debugInfo).toEqual({ logs: [] });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// createErrorResult
// ──────────────────────────────────────────────────────────────────────────────

describe('createErrorResult', () => {
  it('builds a failed result with the error message and duration metrics', () => {
    const startTime = new Date(Date.now() - 10);
    const error = new AgentError('kaboom', 'execution', false);
    const result = createErrorResult(makeContext(), error, startTime);

    expect(result.success).toBe(false);
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toBe('kaboom');
    expect(result.metrics?.startTime).toBe(startTime);
    expect(result.metrics?.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.debugInfo).toEqual({ logs: [] });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// wrapError
// ──────────────────────────────────────────────────────────────────────────────

describe('wrapError', () => {
  it('returns an AgentError unchanged', () => {
    const original = new AgentError('already wrapped', 'network', true);
    expect(wrapError(original)).toBe(original);
  });

  it('wraps a plain Error as a non-recoverable execution AgentError with cause set', () => {
    const original = new Error('plain');
    const wrapped = wrapError(original);
    expect(wrapped).toBeInstanceOf(AgentError);
    expect(wrapped.message).toBe('plain');
    expect(wrapped.type).toBe('execution');
    expect(wrapped.recoverable).toBe(false);
    expect(wrapped.cause).toBe(original);
  });

  it('wraps a non-Error thrown value as an internal AgentError', () => {
    const wrapped = wrapError('just a string');
    expect(wrapped).toBeInstanceOf(AgentError);
    expect(wrapped.message).toBe('just a string');
    expect(wrapped.type).toBe('internal');
    expect(wrapped.recoverable).toBe(false);
  });
});
