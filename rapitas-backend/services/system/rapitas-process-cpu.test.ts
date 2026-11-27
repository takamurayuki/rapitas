/**
 * rapitas-process-cpu.test
 *
 * Task 1553: the resource gate must judge on the CPU of rapitas's own process
 * tree (backend + agents + verification children, grandchildren included),
 * averaged over a window — never on other applications' load.
 */
import { describe, test, expect } from 'bun:test';
import {
  parseCimOutput,
  parsePsOutput,
  parsePsTime,
  collectTree,
  computeIntervalCpuMs,
  windowAveragePercent,
  type ProcSample,
} from './rapitas-process-cpu';

describe('parsers', () => {
  test('parseCimOutput reads pid,ppid,100ns-ticks lines into ms', () => {
    const out = 'header noise\r\n100,4,20000000\r\n200,100,5000\r\n\r\nbad,line\r\n';
    expect(parseCimOutput(out)).toEqual([
      { pid: 100, ppid: 4, cpuMs: 2000 },
      { pid: 200, ppid: 100, cpuMs: 0.5 },
    ]);
  });

  test('parsePsTime handles mm:ss, hh:mm:ss and dd-hh:mm:ss', () => {
    expect(parsePsTime('00:05')).toBe(5_000);
    expect(parsePsTime('01:02:03')).toBe((3600 + 120 + 3) * 1000);
    expect(parsePsTime('2-00:00:01')).toBe((2 * 86400 + 1) * 1000);
    expect(parsePsTime('1:05.50')).toBe(65_500);
    expect(parsePsTime('garbage')).toBeNull();
  });

  test('parsePsOutput reads pid ppid time', () => {
    expect(parsePsOutput('  10     1 00:00:02\n  11    10 00:01:00\nxx\n')).toEqual([
      { pid: 10, ppid: 1, cpuMs: 2000 },
      { pid: 11, ppid: 10, cpuMs: 60_000 },
    ]);
  });
});

describe('collectTree', () => {
  const snap: ProcSample[] = [
    { pid: 1, ppid: 0, cpuMs: 999 }, // system
    { pid: 100, ppid: 1, cpuMs: 10 }, // backend (root)
    { pid: 110, ppid: 100, cpuMs: 20 }, // cmd.exe (verify shell)
    { pid: 111, ppid: 110, cpuMs: 30 }, // tsc (grandchild)
    { pid: 120, ppid: 100, cpuMs: 5 }, // sampler powershell
    { pid: 500, ppid: 1, cpuMs: 99_999 }, // msedgewebview2 (other app)
  ];

  test('keeps the root and every descendant, grandchildren included', () => {
    const pids = collectTree(snap, 100, new Set())
      .map((s) => s.pid)
      .sort();
    expect(pids).toEqual([100, 110, 111, 120]);
  });

  test("excludes the sampler's own process", () => {
    const pids = collectTree(snap, 100, new Set([120])).map((s) => s.pid);
    expect(pids).not.toContain(120);
  });

  test('another application outside the tree is never included', () => {
    expect(collectTree(snap, 100, new Set()).map((s) => s.pid)).not.toContain(500);
  });

  test('survives a ppid cycle (pid reuse) without looping', () => {
    const cyc: ProcSample[] = [
      { pid: 100, ppid: 200, cpuMs: 1 },
      { pid: 200, ppid: 100, cpuMs: 1 },
    ];
    expect(collectTree(cyc, 100, new Set()).length).toBe(2);
  });

  test('a missing root yields an empty tree', () => {
    expect(collectTree(snap, 4242, new Set())).toEqual([]);
  });
});

describe('computeIntervalCpuMs', () => {
  test('sums per-pid deltas; a new pid adds its whole value; exited pids add nothing', () => {
    const prev: ProcSample[] = [
      { pid: 100, ppid: 1, cpuMs: 1000 },
      { pid: 110, ppid: 100, cpuMs: 500 },
    ];
    const cur: ProcSample[] = [
      { pid: 100, ppid: 1, cpuMs: 1600 },
      { pid: 111, ppid: 100, cpuMs: 300 },
    ];
    expect(computeIntervalCpuMs(prev, cur)).toBe(600 + 300);
  });

  test('a counter that went backwards (pid reuse) counts as new, never negative', () => {
    expect(
      computeIntervalCpuMs([{ pid: 7, ppid: 1, cpuMs: 900 }], [{ pid: 7, ppid: 1, cpuMs: 100 }]),
    ).toBe(100);
  });
});

describe('windowAveragePercent', () => {
  const now = 1_000_000;
  test('averages only the intervals inside the window, as % of host capacity', () => {
    const intervals = [
      { at: now - 400_000, cpuMs: 120_000, elapsedMs: 30_000 }, // outside a 5-min window
      { at: now - 60_000, cpuMs: 30_000, elapsedMs: 30_000 },
      { at: now, cpuMs: 30_000, elapsedMs: 30_000 },
    ];
    // 60 s CPU over 60 s × 4 cores = 25%
    expect(windowAveragePercent(intervals, 300_000, 4, now)).toBe(25);
  });

  test('null without any interval in the window', () => {
    expect(windowAveragePercent([], 300_000, 4, now)).toBeNull();
    expect(
      windowAveragePercent([{ at: now - 999_999, cpuMs: 1, elapsedMs: 1 }], 300_000, 4, now),
    ).toBeNull();
  });

  test('clamps to [0, 100]', () => {
    expect(windowAveragePercent([{ at: now, cpuMs: 1e9, elapsedMs: 1 }], 300_000, 4, now)).toBe(
      100,
    );
  });
});
