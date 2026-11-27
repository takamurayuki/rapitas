/**
 * gemini-cli-runner.priority.test
 *
 * Task 1553: the Gemini CLI must start through spawnLowPriority with the
 * agent family flag, like the claude/codex paths, so it runs BELOW_NORMAL.
 *
 * Run this file on its own: bun's mock.module is process-global and this
 * file replaces process-priority and gemini-cli-agent.
 */
import { describe, test, expect, mock, afterAll } from 'bun:test';
import { EventEmitter } from 'node:events';
import * as realPriority from '../process-priority';

const calls: Array<{ command: string; flag: string | undefined }> = [];
mock.module('../process-priority', () => ({
  ...realPriority,
  spawnLowPriority: (command: string, _args: string[], _opts: unknown, flag?: string) => {
    calls.push({ command, flag });
    const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
    proc.pid = 9090;
    proc.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
    proc.stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });
    proc.stdin = { end: () => {} };
    proc.kill = () => true;
    setTimeout(() => proc.emit('close', 0), 5);
    return proc;
  },
}));
mock.module('./gemini-cli-agent', () => ({
  resolveCliPath: async (p: string) => p,
  GeminiCliAgentV2: class {},
}));

const { runGeminiCli } = await import('./gemini-cli-runner');

afterAll(() => mock.restore());

describe('runGeminiCli priority (task 1553)', () => {
  test('starts the CLI via spawnLowPriority with RAPITAS_AGENT_QUIET', async () => {
    const state: Parameters<typeof runGeminiCli>[4] = {
      outputBuffer: '',
      errorBuffer: '',
      lineBuffer: '',
      geminiSessionId: null,
      checkpointId: null,
      process: null,
    };
    await runGeminiCli(
      'hello',
      process.cwd(),
      { timeout: 10_000 } as unknown as Parameters<typeof runGeminiCli>[2],
      {} as Parameters<typeof runGeminiCli>[3],
      state,
      async () => {},
      () => {},
    );
    expect(calls.length).toBe(1);
    expect(calls[0]!.flag).toBe('RAPITAS_AGENT_QUIET');
  });
});
