/**
 * base-agent.test
 *
 * Covers BaseAgent's concrete surface (everything not marked abstract):
 * constructor identity fields, logPrefix, status accessor, output/question
 * handler wiring + emit guards, and the default no-op pause/resume.
 * Exercised through a minimal concrete subclass since BaseAgent is abstract.
 */
import { describe, test, expect, mock } from 'bun:test';
import {
  BaseAgent,
  type AgentCapability,
  type AgentExecutionResult,
  type AgentStatus,
  type QuestionDetectedHandler,
} from './base-agent';

/** Minimal concrete subclass exposing BaseAgent's protected members for testing. */
class FixtureAgent extends BaseAgent {
  getCapabilities(): AgentCapability {
    return {
      codeGeneration: true,
      codeReview: false,
      taskAnalysis: false,
      fileOperations: false,
      terminalAccess: false,
    };
  }

  async execute(): Promise<AgentExecutionResult> {
    return { success: true, output: '' };
  }

  async stop(): Promise<void> {
    this.status = 'cancelled';
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async validateConfig(): Promise<{ valid: boolean; errors: string[] }> {
    return { valid: true, errors: [] };
  }

  setTestStatus(status: AgentStatus): void {
    this.status = status;
  }

  triggerEmitOutput(output: string, isError?: boolean): void {
    this.emitOutput(output, isError);
  }

  triggerEmitQuestionDetected(info: Parameters<QuestionDetectedHandler>[0]): void {
    this.emitQuestionDetected(info);
  }
}

describe('BaseAgent construction', () => {
  test('exposes id/name/type as passed to the constructor', () => {
    const agent = new FixtureAgent('agent-1', 'Claude Code', 'claude-code');
    expect(agent.id).toBe('agent-1');
    expect(agent.name).toBe('Claude Code');
    expect(agent.type).toBe('claude-code');
  });

  test('defaults status to idle', () => {
    const agent = new FixtureAgent('a', 'n', 't');
    expect(agent.getStatus()).toBe('idle');
  });
});

describe('BaseAgent.logPrefix', () => {
  test('formats as [name]', () => {
    const agent = new FixtureAgent('a', 'Gemini CLI', 'gemini-cli');
    expect(agent.logPrefix).toBe('[Gemini CLI]');
  });
});

describe('BaseAgent.getStatus', () => {
  test('reflects status mutated by a subclass (e.g. after stop())', async () => {
    const agent = new FixtureAgent('a', 'n', 't');
    await agent.stop();
    expect(agent.getStatus()).toBe('cancelled');
  });
});

describe('BaseAgent.pause / resume', () => {
  test('pause() defaults to unsupported (false)', async () => {
    const agent = new FixtureAgent('a', 'n', 't');
    await expect(agent.pause()).resolves.toBe(false);
  });

  test('resume() defaults to unsupported (false)', async () => {
    const agent = new FixtureAgent('a', 'n', 't');
    await expect(agent.resume()).resolves.toBe(false);
  });
});

describe('BaseAgent.setOutputHandler / emitOutput', () => {
  test('does nothing when no handler is registered', () => {
    const agent = new FixtureAgent('a', 'n', 't');
    expect(() => agent.triggerEmitOutput('hello')).not.toThrow();
  });

  test('invokes the handler with output and default isError=false', () => {
    const handler = mock((_output: string, _isError?: boolean) => {});
    const agent = new FixtureAgent('a', 'n', 't');
    agent.setOutputHandler(handler);
    agent.triggerEmitOutput('hello');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('hello', false);
  });

  test('forwards isError=true through to the handler', () => {
    const handler = mock((_output: string, _isError?: boolean) => {});
    const agent = new FixtureAgent('a', 'n', 't');
    agent.setOutputHandler(handler);
    agent.triggerEmitOutput('boom', true);
    expect(handler).toHaveBeenCalledWith('boom', true);
  });

  test.each([
    { name: 'the sentinel "null" string', value: 'null' },
    { name: 'the sentinel "undefined" string', value: 'undefined' },
    // HACK(agent): emitOutput's runtime null-guard implies callers may pass
    // null despite the `string` param type; cast to exercise that guard.
    { name: 'null (runtime nullable, despite string typing)', value: null as unknown as string },
  ])('suppresses output when it is $name', ({ value }) => {
    const handler = mock((_output: string, _isError?: boolean) => {});
    const agent = new FixtureAgent('a', 'n', 't');
    agent.setOutputHandler(handler);
    agent.triggerEmitOutput(value);
    expect(handler).not.toHaveBeenCalled();
  });

  test('still emits a normal string that merely contains "null" as a substring', () => {
    const handler = mock((_output: string, _isError?: boolean) => {});
    const agent = new FixtureAgent('a', 'n', 't');
    agent.setOutputHandler(handler);
    agent.triggerEmitOutput('this is not null-only text');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('BaseAgent.setQuestionDetectedHandler / emitQuestionDetected', () => {
  test('does nothing when no handler is registered', () => {
    const agent = new FixtureAgent('a', 'n', 't');
    expect(() =>
      agent.triggerEmitQuestionDetected({ question: 'q?', questionType: 'tool_call' }),
    ).not.toThrow();
  });

  test('invokes the handler with the full info payload', () => {
    const handler = mock((_info: Parameters<QuestionDetectedHandler>[0]) => {});
    const agent = new FixtureAgent('a', 'n', 't');
    agent.setQuestionDetectedHandler(handler);
    const info: Parameters<QuestionDetectedHandler>[0] = {
      question: 'Proceed?',
      questionType: 'tool_call',
      claudeSessionId: 'session-123',
    };
    agent.triggerEmitQuestionDetected(info);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(info);
  });
});
