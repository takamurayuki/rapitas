import { describe, expect, mock, test } from 'bun:test';
import { createInitialWaitingState } from '../../services/agents/question-detection';
import type {
  ProcessRunnerCallbacks,
  ProcessRunnerState,
} from '../../services/agents/codex-cli-agent/process-runner';

mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

const { processJsonEvent } =
  await import('../../services/agents/codex-cli-agent/json-event-handler');

function createHarness() {
  const emitted: string[] = [];
  const sessionIds: string[] = [];
  const state: ProcessRunnerState = {
    process: null,
    outputBuffer: '',
    errorBuffer: '',
    lineBuffer: '',
    detectedQuestion: createInitialWaitingState(),
    activeTools: new Map(),
    codexSessionId: null,
    actualModel: null,
    status: 'running',
  };
  const callbacks: ProcessRunnerCallbacks = {
    emitOutput: (text) => emitted.push(text),
    emitQuestionDetected: () => {},
    onSessionId: (sessionId) => sessionIds.push(sessionId),
    onQuestionDetected: () => {},
    onStatusChange: (status) => {
      state.status = status;
    },
    logPrefix: '[Codex]',
  };

  return { state, callbacks, emitted, sessionIds };
}

describe('codex json-event-handler', () => {
  test('captures Codex 0.125 thread.started as resumable session id', () => {
    const h = createHarness();

    processJsonEvent(
      { type: 'thread.started', thread_id: '019ddcde-c04a-7b60-923a-fed5acf26038' },
      h.state,
      h.callbacks,
      {},
      '[Codex]',
    );

    expect(h.state.codexSessionId).toBe('019ddcde-c04a-7b60-923a-fed5acf26038');
    expect(h.sessionIds).toEqual(['019ddcde-c04a-7b60-923a-fed5acf26038']);
    expect(h.emitted).toEqual([]);
  });

  test('emits current Codex error events to the live output buffer', () => {
    const h = createHarness();

    processJsonEvent(
      { type: 'error', message: 'stream disconnected before completion' },
      h.state,
      h.callbacks,
      {},
      '[Codex]',
    );

    expect(h.state.outputBuffer).toContain('[Error] stream disconnected before completion');
    expect(h.emitted.join('')).toContain('[Error] stream disconnected before completion');
  });

  test('emits turn.failed without pre-resolving runner status', () => {
    const h = createHarness();

    processJsonEvent(
      {
        type: 'turn.failed',
        error: { message: 'thread/start failed' },
      },
      h.state,
      h.callbacks,
      {},
      '[Codex]',
    );

    expect(h.state.outputBuffer).toContain('[Result: failed]');
    expect(h.state.outputBuffer).toContain('thread/start failed');
    expect(h.state.status).toBe('running');
  });
});
