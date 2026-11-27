/**
 * generated-sync-check.heavy-slot.test
 *
 * Task 1553: ciParityChecks fires its three drift scripts through
 * Promise.all; each must take the cross-task heavy slot so they run one at a
 * time instead of three bun processes at once.
 *
 * Run this file on its own: bun's mock.module is process-global and this
 * file replaces process-priority and the logger.
 */
import { describe, test, expect, mock, afterAll } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

let running = 0;
let peak = 0;
const started: string[] = [];
const children: FakeChild[] = [];
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = () => true;
}
let automaticClose = true;
// Mirror every process-priority export: a missing one makes this file error out.
mock.module('../process-priority', () => ({
  LOW_PRIORITY: 10,
  isLowPriorityEnabled: () => true,
  lowerProcessPriority: () => true,
  spawnLowPriority: (command: string, args: string[]) => {
    started.push(args.length ? args[1]! : command.split(' ').at(-1)!);
    running++;
    peak = Math.max(peak, running);
    const child = new FakeChild();
    child.once('close', () => running--);
    children.push(child);
    if (automaticClose) setTimeout(() => child.emit('close', 0), 15);
    return child as unknown as ChildProcess;
  },
  countActiveHelperChildren: () => 0,
  execFileLowPriority: async (_file: string, args: string[]) => {
    started.push(args[1] ?? '');
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 15));
    running--;
    return { stdout: '', stderr: '' };
  },
}));

const { ciParityChecks } = await import('./generated-sync-check');

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  mock.restore();
});

describe('ciParityChecks drift scripts (task 1553)', () => {
  test('the three drift scripts never run at the same time', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'gen-sync-slot-'));
    dirs.push(workdir);
    mkdirSync(join(workdir, 'rapitas-backend'), { recursive: true });
    writeFileSync(join(workdir, 'rapitas-backend', 'package.json'), '{}');
    const checks = await ciParityChecks(workdir, ['rapitas-backend/services/x.ts']);
    expect(started.length).toBe(3);
    expect(peak).toBe(1);
    expect(checks.find((c) => c.name === 'generated-sync')?.ok).toBe(true);
  });

  test('生成物の出力上限超過後は close まで次のスクリプトが待機する', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'gen-sync-overflow-'));
    dirs.push(workdir);
    mkdirSync(join(workdir, 'rapitas-backend'));
    writeFileSync(join(workdir, 'rapitas-backend', 'package.json'), '{}');
    children.length = 0;
    automaticClose = false;
    const result = ciParityChecks(workdir, ['rapitas-backend/services/x.ts']);
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    await tick();
    if (children.length === 0) {
      await result;
      throw new Error('共通 runner が子プロセスを起動していない');
    }
    children[0]!.stdout.emit('data', Buffer.alloc(4 * 1024 * 1024 + 1));
    await tick();
    const afterOverflow = children.length;
    children[0]!.emit('close', 1);
    await tick();
    children[1]!.emit('close', 0);
    await tick();
    children[2]!.emit('close', 0);
    expect((await result).find((c) => c.name === 'generated-sync')?.ok).toBe(true);
    expect(afterOverflow).toBe(1);
  });
});
