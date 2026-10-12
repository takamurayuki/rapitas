/**
 * worker-message-handler — tool_use forwarding to the plan-deviation recorder.
 *
 * Premortem #1 of task 1218: if the stream is not wired to the recorder,
 * every execution silently reports `no_operations`. A tool_use event that
 * reaches the handler must produce exactly one NDJSON operation line.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleWorkerMessage, type WorkerMessageContext } from './worker-message-handler';
import { createOperationStore } from '../../workflow/plan-deviation/operation-store';
import type { WorkerAssistantMessage } from '../../../workers/output-parser-types';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wmh-ops-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeCtx(toolUseHandler?: WorkerMessageContext['toolUseHandler']): WorkerMessageContext {
  return {
    logPrefix: '[Claude Code]',
    resumeSessionId: undefined,
    process: null,
    activeTools: new Map(),
    instructedModel: undefined,
    toolUseHandler,
    outputBuffer: '',
    finalResultText: '',
    claudeSessionId: null,
    detectedQuestion: {} as WorkerMessageContext['detectedQuestion'],
    hasFileModifyingToolCalls: false,
    workerArtifacts: [],
    workerCommits: [],
    workerResultUsage: null,
    onParseComplete: null,
    parserWorker: null,
    status: 'running',
    emitOutputInternal: mock(() => {}),
    emitQuestionDetectedInternal: mock(() => {}),
    killProcessForQuestionInternal: mock(() => {}),
  };
}

const message: WorkerAssistantMessage = {
  type: 'assistant-message',
  displayOutput: '\n[Tool: Write] src/a.ts\n',
  toolUses: [{ id: 'tu_1', name: 'Write', info: 'src/a.ts', isFileModifying: true }],
  toolCalls: [{ id: 'tu_1', name: 'Write', input: { file_path: 'src/a.ts', content: 'x' } }],
};

describe('handleWorkerMessage — tool_use recording', () => {
  test('one tool_use event appends one operation line', () => {
    const store = createOperationStore({ baseDir: dir });
    const ctx = makeCtx((name, input) => {
      store.recordToolUse(42, name, input);
    });
    handleWorkerMessage(ctx, message);
    const lines = readFileSync(join(dir, 'plan-ops', '42.ndjson'), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ kind: 'file_change', features: { path: 'src/a.ts' } });
    // Display output path is unchanged.
    expect(ctx.emitOutputInternal).toHaveBeenCalledTimes(1);
  });

  test('a throwing recorder never breaks output handling', () => {
    const ctx = makeCtx(() => {
      throw new Error('disk full');
    });
    handleWorkerMessage(ctx, message);
    expect(ctx.outputBuffer).toContain('[Tool: Write]');
    expect(ctx.activeTools.has('tu_1')).toBe(true);
  });

  test('no handler registered → nothing recorded', () => {
    handleWorkerMessage(makeCtx(), message);
    expect(existsSync(join(dir, 'plan-ops'))).toBe(false);
  });
});
