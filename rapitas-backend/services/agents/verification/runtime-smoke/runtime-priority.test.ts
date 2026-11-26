/**
 * runtime-priority.test
 *
 * Task 1553: the runtime check's app process and the playwright worker must be
 * STARTED at low priority (BELOW_NORMAL on Windows, nice 10 elsewhere), not
 * lowered after spawn() returns — a shell could start the dev server or the
 * browser before the pid was lowered. They go through
 * spawnLowPriorityUntracked with the verification family flag, and stay out of
 * spawnLowPriority's helper set that the restart gate counts.
 *
 * Run this file on its own: bun's mock.module is process-global and this
 * file replaces process-priority. No real process starts.
 */
import { describe, test, expect, mock, afterAll } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ChildProcess, SpawnOptions } from 'child_process';
import * as realPriority from '../../process-priority';

class FakeProc extends EventEmitter {
  pid = 5150;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { write: () => true, end: () => {} });
  kill = () => true;
}

interface Launch {
  command: string;
  args: string[];
  options: SpawnOptions;
  flag: string | undefined;
}
const launches: Launch[] = [];
let trackedCalls = 0;
let afterSpawnLowerCalls = 0;

// Mirror every process-priority export the modules under test can reach.
mock.module('../../process-priority', () => ({
  ...realPriority,
  spawnLowPriorityUntracked: (
    command: string,
    args: string[],
    options: SpawnOptions,
    flag?: string,
  ) => {
    launches.push({ command, args, options, flag });
    return new FakeProc() as unknown as ChildProcess;
  },
  spawnLowPriority: () => {
    trackedCalls++;
    return new FakeProc() as unknown as ChildProcess;
  },
  lowerProcessPriority: () => {
    afterSpawnLowerCalls++;
    return true;
  },
}));

const { launchApp } = await import('./app-launcher');
const { spawnPlaywrightWorker } = await import('./playwright-worker-client');

afterAll(() => mock.restore());

describe('runtime-smoke starts its processes at low priority (task 1553)', () => {
  test('launchApp starts the app through the low-priority launcher, with the shell and the verify flag', () => {
    launches.length = 0;
    launchApp('bun run dev', process.cwd(), 39999);
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({
      command: 'bun run dev',
      args: [],
      flag: 'RAPITAS_VERIFY_QUIET',
    });
    expect(launches[0]!.options.shell).toBe(true);
    expect(launches[0]!.options.cwd).toBe(process.cwd());
  });

  test('spawnPlaywrightWorker starts the worker through the low-priority launcher', () => {
    launches.length = 0;
    spawnPlaywrightWorker();
    expect(launches).toHaveLength(1);
    expect(launches[0]!.flag).toBe('RAPITAS_VERIFY_QUIET');
    expect(launches[0]!.args.length).toBeGreaterThan(0);
  });

  test('neither joins the tracked helper set, and neither lowers the pid after spawn', () => {
    // The old code lowered the pid after spawn() returned; that left a window
    // in which the shell had already started the child at normal priority.
    expect(trackedCalls).toBe(0);
    expect(afterSpawnLowerCalls).toBe(0);
  });

  test('the priority they get is 10 (Windows BelowNormal / POSIX nice 10)', () => {
    expect(realPriority.LOW_PRIORITY).toBe(10);
  });
});
