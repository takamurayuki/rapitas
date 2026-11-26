/**
 * resource-telemetry.test
 *
 * Verifies the tick-delta CPU busy calculation, the enable-flag contract
 * (default ON since task 1553), and the rapitas process-tree sampler with an
 * injected snapshot reader — no real timers firing, no real CIM/ps call.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import os from 'os';
import {
  computeBusyPercent,
  getHostCpuBusyPercent,
  getRapitasCpuBusyPercent,
  sampleResourceTelemetryNow,
  startResourceTelemetryIfEnabled,
  stopResourceTelemetry,
} from './resource-telemetry';
import type { ProcSample } from './rapitas-process-cpu';

const CORES = os.availableParallelism();
const HOUR = 3_600_000;

describe('computeBusyPercent', () => {
  it('computes busy% from idle/total tick deltas (idle 20 / total 100 -> 80%)', () => {
    const previous = { idle: 100, total: 1000 };
    const current = { idle: 120, total: 1100 };
    expect(computeBusyPercent(previous, current)).toBe(80);
  });

  it('returns 0 when nothing was busy (idle delta == total delta)', () => {
    const previous = { idle: 100, total: 1000 };
    const current = { idle: 200, total: 1100 };
    expect(computeBusyPercent(previous, current)).toBe(0);
  });

  it('returns null when the total ticks did not move (degenerate interval)', () => {
    const previous = { idle: 100, total: 1000 };
    const current = { idle: 100, total: 1000 };
    expect(computeBusyPercent(previous, current)).toBeNull();
  });
});

describe('resource telemetry lifecycle', () => {
  afterEach(() => {
    stopResourceTelemetry();
    delete process.env.RAPITAS_RESOURCE_GATE_ENABLED;
  });

  it('returns null before any sample has completed', () => {
    expect(getHostCpuBusyPercent()).toBeNull();
    expect(getRapitasCpuBusyPercent()).toBeNull();
  });

  it('does not start the sampler when the gate flag is false', async () => {
    process.env.RAPITAS_RESOURCE_GATE_ENABLED = 'false';
    let reads = 0;
    startResourceTelemetryIfEnabled(HOUR, {
      readSnapshot: async () => {
        reads++;
        return { rows: [] };
      },
    });
    await Promise.resolve();
    expect(reads).toBe(0);
    expect(getHostCpuBusyPercent()).toBeNull();
  });

  it('starts by default when the flag is unset (task 1553)', async () => {
    delete process.env.RAPITAS_RESOURCE_GATE_ENABLED;
    let reads = 0;
    startResourceTelemetryIfEnabled(HOUR, {
      readSnapshot: async () => {
        reads++;
        return { rows: [] };
      },
    });
    await Promise.resolve();
    expect(reads).toBe(1);
  });

  it('stopResourceTelemetry clears the cache and is safe to call twice', () => {
    process.env.RAPITAS_RESOURCE_GATE_ENABLED = 'true';
    startResourceTelemetryIfEnabled(50, { readSnapshot: async () => ({ rows: [] }) });
    stopResourceTelemetry();
    stopResourceTelemetry();
    expect(getHostCpuBusyPercent()).toBeNull();
    expect(getRapitasCpuBusyPercent()).toBeNull();
  });
});

describe('rapitas process-tree CPU (task 1553)', () => {
  afterEach(() => stopResourceTelemetry());

  const me = process.pid;
  function snapshot(ownMs: number, childMs: number, otherAppMs: number): ProcSample[] {
    return [
      { pid: me, ppid: 1, cpuMs: ownMs },
      { pid: 900001, ppid: me, cpuMs: 0 }, // cmd.exe shell
      { pid: 900002, ppid: 900001, cpuMs: childMs }, // tsc grandchild
      { pid: 900003, ppid: me, cpuMs: 1e9 }, // the sampler itself
      { pid: 900004, ppid: 1, cpuMs: otherAppMs }, // another application
    ];
  }

  it('averages only rapitas tree CPU; other apps and the sampler are excluded', async () => {
    let t = 1_000_000;
    const snaps = [snapshot(0, 0, 0), snapshot(10_000, 20_000, 9_999_999)];
    startResourceTelemetryIfEnabled(HOUR, {
      now: () => t,
      readSnapshot: async () => ({ rows: snaps.shift()!, samplerPid: 900003 }),
    });
    await sampleResourceTelemetryNow(); // awaits the in-flight first snapshot
    expect(getRapitasCpuBusyPercent()).toBeNull(); // fewer than two snapshots
    t += 30_000;
    await sampleResourceTelemetryNow();
    // 30 s of tree CPU over 30 s × cores.
    expect(getRapitasCpuBusyPercent(t)).toBeCloseTo((30_000 / (30_000 * CORES)) * 100, 5);
  });

  it('shouldSample=false runs no snapshot (no CIM cost at parallelism 1)', async () => {
    let reads = 0;
    startResourceTelemetryIfEnabled(HOUR, {
      shouldSample: () => false,
      readSnapshot: async () => {
        reads++;
        return { rows: [] };
      },
    });
    await sampleResourceTelemetryNow();
    expect(reads).toBe(0);
  });

  it('never runs two snapshots at once while one is still pending', async () => {
    let reads = 0;
    startResourceTelemetryIfEnabled(HOUR, {
      readSnapshot: () => {
        reads++;
        return new Promise(() => {}); // a CIM call that never returns
      },
    });
    void sampleResourceTelemetryNow();
    void sampleResourceTelemetryNow();
    expect(reads).toBe(1);
  });

  it('a failing snapshot keeps the value null (fail open)', async () => {
    startResourceTelemetryIfEnabled(HOUR, {
      readSnapshot: async () => {
        throw new Error('CIM unavailable');
      },
    });
    await sampleResourceTelemetryNow();
    await sampleResourceTelemetryNow();
    expect(getRapitasCpuBusyPercent()).toBeNull();
  });

  it('a failed snapshot discards the window: null until two successes again (R4)', async () => {
    let t = 1_000_000;
    let own = 0;
    const plan: Array<'ok' | 'fail' | 'empty'> = ['ok', 'ok', 'fail', 'ok', 'ok', 'empty'];
    startResourceTelemetryIfEnabled(HOUR, {
      now: () => t,
      readSnapshot: async () => {
        const step = plan.shift();
        if (step === 'fail') throw new Error('CIM unavailable');
        if (step === 'empty') return { rows: [] }; // own pid missing
        own += 15_000;
        return { rows: [{ pid: me, ppid: 1, cpuMs: own }] };
      },
    });
    await sampleResourceTelemetryNow(); // 1st ok (baseline)
    t += 30_000;
    await sampleResourceTelemetryNow(); // 2nd ok → a value
    expect(getRapitasCpuBusyPercent(t)).not.toBeNull();
    t += 30_000;
    await sampleResourceTelemetryNow(); // failure → stale window dropped
    expect(getRapitasCpuBusyPercent(t)).toBeNull();
    t += 30_000;
    await sampleResourceTelemetryNow(); // 1st ok after failure: baseline only
    expect(getRapitasCpuBusyPercent(t)).toBeNull();
    t += 30_000;
    await sampleResourceTelemetryNow(); // 2nd ok → value again
    expect(getRapitasCpuBusyPercent(t)).not.toBeNull();
    t += 30_000;
    await sampleResourceTelemetryNow(); // empty tree → also dropped
    expect(getRapitasCpuBusyPercent(t)).toBeNull();
  });
});
