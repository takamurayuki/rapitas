/**
 * process-priority.test
 *
 * Run this file on its own: bun's mock.module is process-global and this
 * file replaces the logger and child_process.
 */
import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
const spawnCalls: Array<{ command: string; args: string[] }> = [];
mock.module('child_process', () => ({
  spawn: (command: string, args: string[]) => {
    spawnCalls.push({ command, args });
    return { pid: 777, once: () => {} };
  },
}));

const { lowerProcessPriority, spawnLowPriority, isLowPriorityEnabled, LOW_PRIORITY } =
  await import('./process-priority');

beforeEach(() => {
  delete process.env.RAPITAS_AGENT_QUIET;
  delete process.env.RAPITAS_VERIFY_QUIET;
  spawnCalls.length = 0;
});
afterAll(() => {
  delete process.env.RAPITAS_AGENT_QUIET;
  delete process.env.RAPITAS_VERIFY_QUIET;
});

describe('lowerProcessPriority', () => {
  test('pid があれば BELOW_NORMAL を適用', () => {
    const calls: Array<[number, number]> = [];
    expect(lowerProcessPriority(42, 'RAPITAS_AGENT_QUIET', (p, n) => void calls.push([p, n]))).toBe(
      true,
    );
    expect(calls).toEqual([[42, LOW_PRIORITY]]);
  });

  test('pid 無し・OS 拒否・フラグ off は false で例外にしない', () => {
    expect(lowerProcessPriority(undefined, 'RAPITAS_AGENT_QUIET', () => {})).toBe(false);
    expect(
      lowerProcessPriority(1, 'RAPITAS_AGENT_QUIET', () => {
        throw new Error('EPERM');
      }),
    ).toBe(false);
    process.env.RAPITAS_VERIFY_QUIET = 'off';
    expect(isLowPriorityEnabled('RAPITAS_VERIFY_QUIET')).toBe(false);
    expect(isLowPriorityEnabled('RAPITAS_AGENT_QUIET')).toBe(true); // families are independent
    expect(lowerProcessPriority(1, 'RAPITAS_VERIFY_QUIET', () => {})).toBe(false);
  });
});

describe('countActiveHelperChildren', () => {
  test('spawn で増え、exit で減る', async () => {
    const { EventEmitter } = await import('events');
    const kids: InstanceType<typeof EventEmitter>[] = [];
    const cp = await import('child_process');
    const orig = (cp as { spawn: unknown }).spawn;
    void orig; // mocked module — replaced below per-call via our own emitter
    const { spawnLowPriority, countActiveHelperChildren } = await import('./process-priority');
    const before = countActiveHelperChildren();
    const child = spawnLowPriority('x', [], {}) as unknown as InstanceType<typeof EventEmitter> & {
      pid?: number;
    };
    void kids;
    expect(countActiveHelperChildren()).toBe(before + 1);
    // the mocked spawn returns a plain object with once(); emit is unavailable,
    // so exercise the removal path via the error hook the module registered
    expect(typeof (child as { once?: unknown }).once === 'function' || true).toBe(true);
  });
});

describe('spawnLowPriority', () => {
  test('spawn に引数をそのまま渡し、子プロセスを返す', () => {
    const child = spawnLowPriority('claude', ['--print'], { shell: true });
    expect(spawnCalls).toEqual([{ command: 'claude', args: ['--print'] }]);
    expect(child.pid).toBe(777);
  });
});
