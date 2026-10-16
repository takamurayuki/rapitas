/**
 * adapter-execution.question-handler.test
 *
 * Unit tests for attachQuestionHandler(), the bridge from ClaudeCodeAgent's
 * question-detected callback to the abstraction layer's PendingQuestion shape.
 */
import { describe, it, expect, mock } from 'bun:test';
import { attachQuestionHandler } from './adapter-execution';
import type { ClaudeCodeAgent } from '../../claude-code-agent';
import type { QuestionDetectedHandler } from '../../base-agent';
import type { AgentExecutionContext, PendingQuestion } from '../types';

function makeContext(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return { executionId: 'exec-1', workingDirectory: '/tmp/work', ...overrides };
}

/** Minimal ClaudeCodeAgent stand-in exposing only the method this module calls. */
function makeFakeLegacyAgent(): {
  agent: ClaudeCodeAgent;
  capture: (info: Parameters<QuestionDetectedHandler>[0]) => void;
} {
  let handler: QuestionDetectedHandler | null = null;
  const fake = {
    setQuestionDetectedHandler(h: QuestionDetectedHandler) {
      handler = h;
    },
  };
  return {
    agent: fake as unknown as ClaudeCodeAgent,
    capture: (info) => {
      if (!handler) throw new Error('handler was never registered');
      handler(info);
    },
  };
}

describe('attachQuestionHandler', () => {
  it('builds a PendingQuestion from the legacy question-detected payload', () => {
    const { agent, capture } = makeFakeLegacyAgent();
    let received: PendingQuestion | null = null;
    attachQuestionHandler(agent, makeContext({ timeout: 5000 }), (q) => {
      received = q;
    });

    capture({
      question: 'Proceed?',
      questionType: 'confirmation',
      questionKey: {
        status: 'awaiting_user_input',
        question_id: 'qk-1',
        question_type: 'confirmation',
        requires_response: true,
      },
      questionDetails: {
        options: [{ label: 'Yes', description: 'go ahead' }, { label: 'No' }],
        multiSelect: true,
      },
    });

    expect(received).not.toBeNull();
    expect(received!.questionId).toBe('qk-1');
    expect(received!.text).toBe('Proceed?');
    expect(received!.category).toBe('confirmation');
    expect(received!.multiSelect).toBe(true);
    expect(received!.options).toEqual([
      { label: 'Yes', value: 'Yes', description: 'go ahead' },
      { label: 'No', value: 'No', description: undefined },
    ]);
    // 5000ms context timeout -> 5s question timeout
    expect(received!.timeout).toBe(5);
  });

  it('generates a fallback questionId when questionKey is absent', () => {
    const { agent, capture } = makeFakeLegacyAgent();
    const onQuestion = mock(() => {});
    attachQuestionHandler(agent, makeContext(), onQuestion);

    capture({ question: 'q?', questionType: 'clarification' });

    expect(onQuestion).toHaveBeenCalledTimes(1);
    const question = onQuestion.mock.calls[0][0] as PendingQuestion;
    expect(question.questionId).toMatch(/^q-\d+$/);
  });

  it('defaults timeout to 300 seconds when the context has no timeout', () => {
    const { agent, capture } = makeFakeLegacyAgent();
    const onQuestion = mock(() => {});
    attachQuestionHandler(agent, makeContext(), onQuestion);

    capture({ question: 'q?', questionType: 'clarification' });

    const question = onQuestion.mock.calls[0][0] as PendingQuestion;
    expect(question.timeout).toBe(300);
  });

  it.each([
    ['clarification', 'clarification'],
    ['confirmation', 'confirmation'],
    ['selection', 'selection'],
    ['tool_call', 'input'],
    ['unknown-type', 'input'],
  ] as const)('maps legacy questionType "%s" to category "%s"', (legacyType, expectedCategory) => {
    const { agent, capture } = makeFakeLegacyAgent();
    const onQuestion = mock(() => {});
    attachQuestionHandler(agent, makeContext(), onQuestion);

    capture({ question: 'q?', questionType: legacyType });

    const question = onQuestion.mock.calls[0][0] as PendingQuestion;
    expect(question.category).toBe(expectedCategory);
  });

  it('leaves options/multiSelect undefined when questionDetails is absent', () => {
    const { agent, capture } = makeFakeLegacyAgent();
    const onQuestion = mock(() => {});
    attachQuestionHandler(agent, makeContext(), onQuestion);

    capture({ question: 'q?', questionType: 'clarification' });

    const question = onQuestion.mock.calls[0][0] as PendingQuestion;
    expect(question.options).toBeUndefined();
    expect(question.multiSelect).toBeUndefined();
  });
});
