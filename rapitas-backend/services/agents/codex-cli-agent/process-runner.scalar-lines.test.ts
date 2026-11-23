/**
 * process-runner.scalar-lines.test
 *
 * A raw stdout line that happens to be a JSON scalar (a quoted string, a
 * number, true/false/null) is text, not a Codex event, and must stay in the
 * output. `child_process.spawn` is mocked — no real Codex CLI process runs.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'child_process';
import { createInitialWaitingState } from '../question-detection';
import type { ProcessRunnerState } from './process-runner';

type MutableStream = EventEmitter & { setEncoding: (enc: string) => void };

function makeStream(): MutableStream {
  const em = new EventEmitter() as MutableStream;
  em.setEncoding = mock(() => {});
  return em;
}

class MockChild extends EventEmitter {
  pid = 779;
  killed = false;
  stdout = makeStream();
  stderr = makeStream();
  stdin = Object.assign(new EventEmitter(), {
    write: mock((_data: string) => {}),
    end: mock(() => {}),
    setDefaultEncoding: mock((_enc: string) => {}),
  });
  kill = mock((_signal?: string) => {
    this.killed = true;
  });
}

let spawnedChildren: MockChild[] = [];
const mockSpawn = mock((_command: string, _args: string[], _options: Record<string, unknown>) => {
  const child = new MockChild();
  spawnedChildren.push(child);
  return child as unknown as ChildProcess;
});

mock.module('child_process', () => ({
  spawn: mockSpawn,
  exec: mock(() => {}),
  execFile: mock(() => {}),
  execSync: mock(() => Buffer.from('')),
  execFileSync: mock(() => Buffer.from('')),
  spawnSync: mock(() => ({ status: 0, stdout: '', stderr: '' })),
  fork: mock(() => {}),
}));
mock.module('./types', () => ({
  resolveCliPath: mock((cliName: string) => cliName),
}));

const { spawnCodexProcess } = await import('./process-runner');

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function makeState(): ProcessRunnerState {
  return {
    process: null,
    outputBuffer: '',
    errorBuffer: '',
    lineBuffer: '',
    detectedQuestion: createInitialWaitingState(),
    activeTools: new Map(),
    codexSessionId: null,
    actualModel: null,
    status: 'running',
    turnFailed: false,
    turnFailureMessage: null,
    activeCodexCommands: new Map(),
    seenAgentMessageIds: new Set(),
  };
}

function makeCallbacks() {
  return {
    emitOutput: mock((_text: string, _isError?: boolean) => {}),
    emitQuestionDetected: mock(() => {}),
    onSessionId: mock((_id: string) => {}),
    onQuestionDetected: mock(() => {}),
    onStatusChange: mock((_status: string) => {}),
    logPrefix: '[test-agent]',
  };
}

async function run(config: Record<string, unknown>, stdout: string) {
  const state = makeState();
  const callbacks = makeCallbacks();
  const result = spawnCodexProcess(
    config,
    'C:/work',
    'prompt',
    state,
    callbacks,
    Date.now(),
    () => [],
    () => [],
  );
  await flush();
  const child = spawnedChildren[0];
  child.stdout.emit('data', stdout);
  child.emit('close', 0);
  await result;
  return { state, callbacks };
}

beforeEach(() => {
  spawnedChildren = [];
  mockSpawn.mockClear();
});

// 2026-11-23: TempoRaid task 1403's planner (Codex) wrote its plan four
// times with the last element of every JSON array missing —
// `"docs/requirements.md"` in files, then `"Get-ChildItem"` in commands.
// Each of those lines is itself valid JSON (a string), so the stdout handler
// parsed it as an event, found no `type`, and dropped it; the lines before
// them end in a comma, fail to parse, and survived. The planner was blamed
// for an edit it had made.
describe('spawnCodexProcess — raw lines that are JSON scalars', () => {
  test('keeps the comma-less last element of a JSON array in a written plan', async () => {
    const plan =
      '```json:plan-declaration\n' +
      '{\n' +
      '  "files": [\n' +
      '    "docs/design.md",\n' +
      '    "docs/requirements.md"\n' +
      '  ],\n' +
      '  "commands": ["node"]\n' +
      '}\n' +
      '```\n';
    const { state } = await run({ investigationMode: true }, plan);
    expect(state.outputBuffer).toContain('    "docs/requirements.md"\n');
    expect(state.outputBuffer).toContain('    "docs/design.md",\n');
  });

  test('keeps lines that are bare numbers, booleans or null', async () => {
    const { state } = await run({ investigationMode: true }, '42\ntrue\nnull\n');
    expect(state.outputBuffer).toBe('42\ntrue\nnull\n');
  });

  // 2026-11-23: TempoRaid task 1347's planner wrote its declaration on one
  // line (`{"version":1,"files":[...]}`). That line is a JSON object, so the
  // handler took it for an event with no type and dropped it, and the saved
  // plan had an empty ```json:plan-declaration fence.
  test('keeps a one-line JSON object that has no Codex event type', async () => {
    const line =
      '{"version":1,"files":["apps/web/src/a.ts"],"commands":["pnpm"],"externalHosts":[]}';
    const { state } = await run(
      { investigationMode: true },
      `${line}
`,
    );
    expect(state.outputBuffer).toContain(line);
  });

  test('still treats a JSON object line as a Codex event', async () => {
    const { state, callbacks } = await run(
      { investigationMode: true },
      `${JSON.stringify({ type: 'thread.started', thread_id: 'scalar-thread' })}\n`,
    );
    expect(callbacks.onSessionId).toHaveBeenCalledWith('scalar-thread');
    expect(state.outputBuffer).not.toContain('thread.started');
  });
});
