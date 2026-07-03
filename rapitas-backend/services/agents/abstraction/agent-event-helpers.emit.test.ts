/**
 * agent-event-helpers.emit.test
 *
 * Unit tests for the simple emit-and-invoke-hook helpers: emitOutput,
 * emitQuestion, emitArtifact, emitCommit.
 */
import { describe, it, expect, mock } from 'bun:test';
import { emitOutput, emitQuestion, emitArtifact, emitCommit } from './agent-event-helpers';
import { AgentEventEmitter } from './event-emitter';
import type {
  AgentExecutionContext,
  AgentLifecycleHooks,
  PendingQuestion,
  AgentArtifact,
  GitCommitInfo,
  OutputEvent,
  QuestionEvent,
  ArtifactEvent,
  CommitEvent,
} from './types';

function makeContext(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return { executionId: 'exec-1', workingDirectory: '/tmp/work', ...overrides };
}

const noLog = () => {};

// ── emitOutput ──

describe('emitOutput', () => {
  it('forwards content with default isError/isPartial to the emitter', async () => {
    const events = new AgentEventEmitter('agent-1');
    const captured: OutputEvent[] = [];
    events.on<OutputEvent>('output', async (e) => {
      captured.push(e);
    });

    await emitOutput(events, 'hello');

    expect(captured).toHaveLength(1);
    expect(captured[0].content).toBe('hello');
    expect(captured[0].isError).toBe(false);
    expect(captured[0].isPartial).toBe(false);
  });

  it('forwards explicit isError/isPartial flags', async () => {
    const events = new AgentEventEmitter('agent-1');
    const captured: OutputEvent[] = [];
    events.on<OutputEvent>('output', async (e) => {
      captured.push(e);
    });

    await emitOutput(events, 'stderr text', true, true);

    expect(captured[0].isError).toBe(true);
    expect(captured[0].isPartial).toBe(true);
  });
});

// ── emitQuestion ──

describe('emitQuestion', () => {
  const question: PendingQuestion = {
    questionId: 'q1',
    text: 'Continue?',
    category: 'confirmation',
  };

  it('always emits the question event', async () => {
    const events = new AgentEventEmitter('agent-1');
    const captured: QuestionEvent[] = [];
    events.on<QuestionEvent>('question', async (e) => {
      captured.push(e);
    });

    await emitQuestion(events, {}, makeContext(), question, noLog);

    expect(captured).toHaveLength(1);
    expect(captured[0].question).toBe(question);
  });

  it('does not invoke logFn when no onQuestion hook is configured', async () => {
    const events = new AgentEventEmitter('agent-1');
    const logFn = mock(() => {});

    await emitQuestion(events, {}, makeContext(), question, logFn);

    expect(logFn).not.toHaveBeenCalled();
  });

  it('logs the auto-response when the onQuestion hook returns a non-null string', async () => {
    const events = new AgentEventEmitter('agent-1');
    const logFn = mock(() => {});
    const hooks: AgentLifecycleHooks = { onQuestion: async () => 'auto-yes' };

    await emitQuestion(events, hooks, makeContext(), question, logFn);

    expect(logFn).toHaveBeenCalledTimes(1);
    expect(logFn.mock.calls[0][0]).toBe('info');
    expect(logFn.mock.calls[0][1]).toContain('auto-yes');
  });

  it('does not log when the onQuestion hook returns null', async () => {
    const events = new AgentEventEmitter('agent-1');
    const logFn = mock(() => {});
    const hooks: AgentLifecycleHooks = { onQuestion: async () => null };

    await emitQuestion(events, hooks, makeContext(), question, logFn);

    expect(logFn).not.toHaveBeenCalled();
  });

  it('passes the context and question through to the hook', async () => {
    const events = new AgentEventEmitter('agent-1');
    const context = makeContext();
    const onQuestion = mock(async () => null);

    await emitQuestion(events, { onQuestion }, context, question, noLog);

    expect(onQuestion).toHaveBeenCalledWith(context, question);
  });
});

// ── emitArtifact ──

describe('emitArtifact', () => {
  const artifact: AgentArtifact = { type: 'file', name: 'out.txt', content: 'data' };

  it('always emits the artifact event', async () => {
    const events = new AgentEventEmitter('agent-1');
    const captured: ArtifactEvent[] = [];
    events.on<ArtifactEvent>('artifact', async (e) => {
      captured.push(e);
    });

    await emitArtifact(events, {}, makeContext(), artifact);

    expect(captured).toHaveLength(1);
    expect(captured[0].artifact).toBe(artifact);
  });

  it('invokes the onArtifact hook when configured', async () => {
    const events = new AgentEventEmitter('agent-1');
    const context = makeContext();
    const onArtifact = mock(async () => {});

    await emitArtifact(events, { onArtifact }, context, artifact);

    expect(onArtifact).toHaveBeenCalledWith(context, artifact);
  });

  it('does not throw when onArtifact is not configured', async () => {
    const events = new AgentEventEmitter('agent-1');
    await expect(emitArtifact(events, {}, makeContext(), artifact)).resolves.toBeUndefined();
  });
});

// ── emitCommit ──

describe('emitCommit', () => {
  it('emits a commit event carrying the commit info', async () => {
    const events = new AgentEventEmitter('agent-1');
    const captured: CommitEvent[] = [];
    events.on<CommitEvent>('commit', async (e) => {
      captured.push(e);
    });
    const commit: GitCommitInfo = {
      hash: 'abc123',
      message: 'fix: bug',
      branch: 'main',
      filesChanged: 1,
      additions: 2,
      deletions: 1,
    };

    await emitCommit(events, commit);

    expect(captured).toHaveLength(1);
    expect(captured[0].commit).toBe(commit);
  });
});
