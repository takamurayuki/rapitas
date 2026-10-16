/**
 * claude-code-agent-adapter.test
 *
 * Coverage for ClaudeCodeAgentAdapter.execute()/continue(): lifecycle-hook
 * gating, state-transition sequencing, legacy-result conversion, error
 * wrapping, and question/output forwarding. stop/pause/resume/dispose/
 * getters live in claude-code-agent-adapter.lifecycle.test.ts (300-500 line
 * file-size policy).
 *
 * The legacy `ClaudeCodeAgent` (which spawns the real Claude CLI process) is
 * mocked end-to-end so no process is ever spawned. `../../claude-code-agent`
 * only exports the `ClaudeCodeAgent` class at runtime (`ClaudeCodeAgentConfig`
 * is a type-only export), so the mock factory below is a complete mirror.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type {
  AgentTask,
  AgentExecutionResult as LegacyExecutionResult,
  QuestionDetectedHandler,
  AgentOutputHandler,
} from '../../base-agent';

// ── legacy ClaudeCodeAgent mock ─────────────────────────────────────────────

let nextExecuteResult: LegacyExecutionResult = { success: true, output: 'done' };
let executeError: Error | null = null;
const executeCalls: AgentTask[] = [];
const constructorCalls: Array<{ id: string; name: string; config: Record<string, unknown> }> = [];
let lastInstance: MockClaudeCodeAgent | null = null;

class MockClaudeCodeAgent {
  outputHandler: AgentOutputHandler | null = null;
  questionHandler: QuestionDetectedHandler | null = null;

  constructor(
    public id: string,
    public name: string,
    public config: Record<string, unknown>,
  ) {
    constructorCalls.push({ id, name, config });
    lastInstance = this;
  }

  setOutputHandler(handler: AgentOutputHandler): void {
    this.outputHandler = handler;
  }

  setQuestionDetectedHandler(handler: QuestionDetectedHandler): void {
    this.questionHandler = handler;
  }

  async execute(task: AgentTask): Promise<LegacyExecutionResult> {
    executeCalls.push(task);
    if (executeError) throw executeError;
    return nextExecuteResult;
  }

  async stop(): Promise<void> {}
  async pause(): Promise<boolean> {
    return true;
  }
  async resume(): Promise<boolean> {
    return true;
  }
}

mock.module('../../claude-code-agent', () => ({
  ClaudeCodeAgent: MockClaudeCodeAgent,
}));

const { ClaudeCodeAgentAdapter } = await import('./claude-code-agent-adapter');
import { AgentError } from '../interfaces';
import type {
  AgentExecutionContext,
  AgentExecutionResult,
  AgentTaskDefinition,
  ClaudeCodeProviderConfig,
  ContinuationContext,
  StateChangeEvent,
  OutputEvent,
  QuestionEvent,
} from '../types';

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ClaudeCodeProviderConfig> = {}): ClaudeCodeProviderConfig {
  return { providerId: 'claude-code', enabled: true, ...overrides };
}

function makeContext(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return { executionId: 'exec-1', workingDirectory: '/tmp/work', ...overrides };
}

function makeTask(overrides: Partial<AgentTaskDefinition> = {}): AgentTaskDefinition {
  return { id: 1, title: 'Test task', ...overrides };
}

beforeEach(() => {
  nextExecuteResult = { success: true, output: 'done' };
  executeError = null;
  executeCalls.length = 0;
  constructorCalls.length = 0;
  lastInstance = null;
});

// ── execute() ────────────────────────────────────────────────────────────────

describe('ClaudeCodeAgentAdapter.execute', () => {
  test('happy path transitions idle -> initializing -> running -> completed and converts the result', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    const transitions: string[] = [];
    adapter.events.on<StateChangeEvent>('state_change', (e) => {
      transitions.push(e.newState);
    });

    nextExecuteResult = { success: true, output: 'done', claudeSessionId: 'sess-1' };
    const result = await adapter.execute(makeTask(), makeContext());

    expect(result.success).toBe(true);
    expect(result.state).toBe('completed');
    expect(result.sessionId).toBe('sess-1');
    expect(transitions).toEqual(['initializing', 'running', 'completed']);
    expect(adapter.state).toBe('completed');
    expect(adapter.metadata.lastUsedAt).toBeInstanceOf(Date);
  });

  test('cancels via beforeExecute hook without constructing a legacy agent', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    adapter.setLifecycleHooks({ beforeExecute: async () => false });

    const result = await adapter.execute(makeTask(), makeContext());

    expect(result.success).toBe(false);
    expect(result.state).toBe('cancelled');
    expect(result.errorMessage).toBe('Cancelled by beforeExecute hook');
    expect(constructorCalls.length).toBe(0);
    // NOTE: cancellation happens before the first transitionState() call.
    expect(adapter.state).toBe('idle');
  });

  test('transitions to waiting_for_input when the legacy result carries a question', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    nextExecuteResult = {
      success: false,
      output: '',
      waitingForInput: true,
      question: 'Which approach?',
      questionType: 'tool_call',
    };

    const result = await adapter.execute(makeTask(), makeContext({ timeout: 60000 }));

    expect(result.state).toBe('waiting_for_input');
    expect(result.pendingQuestion?.text).toBe('Which approach?');
    expect(result.pendingQuestion?.category).toBe('input');
    // NOTE: unlike attachQuestionHandler's live 'question' event,
    // convertLegacyResult never sets pendingQuestion.timeout on the final result.
    expect(result.pendingQuestion?.timeout).toBeUndefined();
    expect(adapter.state).toBe('waiting_for_input');
  });

  test('transitions to failed when the legacy result is unsuccessful with no question', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    nextExecuteResult = { success: false, output: '', errorMessage: 'boom' };

    const result = await adapter.execute(makeTask(), makeContext());

    expect(result.success).toBe(false);
    expect(result.state).toBe('failed');
    expect(adapter.state).toBe('failed');
  });

  test('wraps a thrown error, invokes onError, and transitions to failed', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    const onError = mock(
      async (_context: AgentExecutionContext, _error: Error, _retryCount: number) => ({
        retry: false,
      }),
    );
    adapter.setLifecycleHooks({ onError });
    executeError = new Error('cli exploded');

    const result = await adapter.execute(makeTask(), makeContext());

    expect(result.success).toBe(false);
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toBe('cli exploded');
    expect(onError).toHaveBeenCalledTimes(1);
    const [, calledError, calledRetryCount] = onError.mock.calls[0]!;
    expect(calledError).toBeInstanceOf(AgentError);
    expect((calledError as AgentError).type).toBe('execution');
    expect(calledRetryCount).toBe(0);
    expect(adapter.state).toBe('failed');
  });

  test('preserves the AgentError type/recoverable flag when the legacy agent throws one directly', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    executeError = new AgentError('bad config', 'configuration', false);

    const result = await adapter.execute(makeTask(), makeContext());

    expect(result.errorMessage).toBe('bad config');
    expect(result.state).toBe('failed');
  });

  test('invokes afterExecute with the converted result on success', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    const afterExecute = mock(
      async (_context: AgentExecutionContext, _result: AgentExecutionResult) => {},
    );
    adapter.setLifecycleHooks({ afterExecute });

    await adapter.execute(makeTask(), makeContext());

    expect(afterExecute).toHaveBeenCalledTimes(1);
    const [, passedResult] = afterExecute.mock.calls[0]!;
    expect(passedResult.success).toBe(true);
  });

  test('forwards legacy output through setOutputHandler as a partial output event', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    const outputs: OutputEvent[] = [];
    adapter.events.on<OutputEvent>('output', (e) => {
      outputs.push(e);
    });

    // NOTE: lastInstance survives past execute() resolving (the adapter only
    // clears _legacyAgent on stop()/dispose()), so the handler can still be
    // invoked directly here to verify the forwarding wiring.
    nextExecuteResult = { success: true, output: 'done' };
    const execPromise = adapter.execute(makeTask(), makeContext());
    await execPromise;

    lastInstance!.outputHandler!('partial output', false);

    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.content).toBe('partial output');
    expect(outputs[0]!.isError).toBe(false);
    expect(outputs[0]!.isPartial).toBe(true);
  });

  test('maps an unknown legacy question type to the "input" category via attachQuestionHandler', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    const questions: QuestionEvent[] = [];
    adapter.events.on<QuestionEvent>('question', (e) => {
      questions.push(e);
    });

    await adapter.execute(makeTask(), makeContext({ timeout: 30000 }));

    lastInstance!.questionHandler!({
      question: 'Pick one?',
      questionType: 'tool_call',
      questionDetails: {
        options: [{ label: 'A', description: 'first' }],
        multiSelect: false,
      },
      questionKey: {
        status: 'awaiting_user_input',
        question_id: 'q-42',
        question_type: 'clarification',
        requires_response: true,
      },
    });

    expect(questions).toHaveLength(1);
    expect(questions[0]!.question.questionId).toBe('q-42');
    expect(questions[0]!.question.category).toBe('input');
    expect(questions[0]!.question.options).toEqual([
      { label: 'A', value: 'A', description: 'first' },
    ]);
    expect(questions[0]!.question.timeout).toBe(30);
  });

  test('rejects with a disposed AgentError once the adapter has been disposed', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    await adapter.dispose();

    await expect(adapter.execute(makeTask(), makeContext())).rejects.toThrow(
      'Agent has been disposed',
    );
  });
});

// ── continue() ───────────────────────────────────────────────────────────────

describe('ClaudeCodeAgentAdapter.continue', () => {
  test('throws when the adapter is not waiting_for_input', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    const continuation: ContinuationContext = { sessionId: '', previousExecutionId: 'exec-1' };

    await expect(adapter.continue(continuation, makeContext())).rejects.toThrow(
      "Cannot continue execution: agent is in state 'idle', expected 'waiting_for_input'",
    );
  });

  test('resumes with the session captured from the prior execute() and completes', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    nextExecuteResult = {
      success: false,
      output: '',
      waitingForInput: true,
      question: 'Continue?',
      claudeSessionId: 'sess-from-first-run',
    };
    await adapter.execute(makeTask(), makeContext());
    expect(adapter.state).toBe('waiting_for_input');
    constructorCalls.length = 0;

    nextExecuteResult = { success: true, output: 'resumed' };
    const continuation: ContinuationContext = {
      sessionId: '',
      previousExecutionId: 'exec-1',
      userResponse: 'yes',
    };
    const result = await adapter.continue(continuation, makeContext({ executionId: 'exec-2' }));

    expect(result.success).toBe(true);
    expect(result.state).toBe('completed');
    expect(adapter.state).toBe('completed');
    // continuation.sessionId is '' (falsy), so the adapter's remembered session is used.
    expect(constructorCalls[0]!.config.resumeSessionId).toBe('sess-from-first-run');
    expect(constructorCalls[0]!.config.continueConversation).toBe(true);
    expect(executeCalls[executeCalls.length - 1]!.description).toBe('yes');
  });

  test('does not invoke onError and still returns a failed result when the legacy agent throws', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    nextExecuteResult = {
      success: false,
      output: '',
      waitingForInput: true,
      question: 'Continue?',
    };
    await adapter.execute(makeTask(), makeContext());
    const onError = mock(async () => ({ retry: false }));
    adapter.setLifecycleHooks({ onError });

    executeError = new Error('resume failed');
    const continuation: ContinuationContext = {
      sessionId: 'sess-x',
      previousExecutionId: 'exec-1',
    };
    const result = await adapter.continue(continuation, makeContext());

    expect(result.success).toBe(false);
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toBe('resume failed');
    expect(onError).not.toHaveBeenCalled();
    expect(adapter.state).toBe('failed');
  });

  test('rejects with a disposed AgentError once the adapter has been disposed', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    await adapter.dispose();
    const continuation: ContinuationContext = { sessionId: '', previousExecutionId: 'exec-1' };

    await expect(adapter.continue(continuation, makeContext())).rejects.toThrow(
      'Agent has been disposed',
    );
  });
});
