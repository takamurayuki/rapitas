/**
 * runtime-priority.test
 *
 * Task 1553: the runtime check's app process and the playwright worker must
 * be lowered to BELOW_NORMAL (setPriority(pid, 10)) right after spawn, under
 * the verification family flag — without joining spawnLowPriority's helper
 * set that the restart gate counts.
 *
 * Run this file on its own: bun's mock.module is process-global and this
 * file replaces child_process and process-priority. No real process starts.
 */
import { describe, test, expect, mock, afterAll } from 'bun:test';
import { EventEmitter } from 'node:events';
import * as realChildProcess from 'child_process';
import * as realPriority from '../../process-priority';

class FakeProc extends EventEmitter {
  pid = 5150;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { write: () => true, end: () => {} });
  kill = () => true;
}

const spawned: string[] = [];
mock.module('child_process', () => ({
  ...realChildProcess,
  spawn: (command: string) => {
    spawned.push(command);
    return new FakeProc() as unknown as realChildProcess.ChildProcess;
  },
}));

const lowered: Array<{ pid: number | undefined; flag: string }> = [];
let spawnLowPriorityCalls = 0;
mock.module('../../process-priority', () => ({
  ...realPriority,
  lowerProcessPriority: (pid: number | undefined, flag: string) => {
    lowered.push({ pid, flag });
    return true;
  },
  spawnLowPriority: (...args: Parameters<typeof realPriority.spawnLowPriority>) => {
    spawnLowPriorityCalls++;
    return realPriority.spawnLowPriority(...args);
  },
}));

const { launchApp } = await import('./app-launcher');
const { spawnPlaywrightWorker } = await import('./playwright-worker-client');

afterAll(() => mock.restore());

describe('runtime-smoke process priority (task 1553)', () => {
  test('launchApp lowers the app process it spawned', () => {
    lowered.length = 0;
    launchApp('bun run dev', process.cwd(), 39999);
    expect(spawned).toContain('bun run dev');
    expect(lowered).toEqual([{ pid: 5150, flag: 'RAPITAS_VERIFY_QUIET' }]);
    expect(spawnLowPriorityCalls).toBe(0);
  });

  test('spawnPlaywrightWorker lowers the worker it spawned', () => {
    lowered.length = 0;
    spawnPlaywrightWorker();
    expect(lowered).toEqual([{ pid: 5150, flag: 'RAPITAS_VERIFY_QUIET' }]);
    expect(spawnLowPriorityCalls).toBe(0);
  });

  test('the priority they get is 10 (Windows BelowNormal / POSIX nice 10)', () => {
    // lowerProcessPriority applies LOW_PRIORITY; its setPriority call is covered by process-priority.test.ts.
    expect(realPriority.LOW_PRIORITY).toBe(10);
  });
});
