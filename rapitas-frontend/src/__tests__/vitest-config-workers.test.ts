// @vitest-environment node
/**
 * vitest-config-workers.test
 *
 * Task 1553 acceptance 4: the frontend vitest pool is capped at 2 workers
 * (the same value the verification gate passes on hosts with 4 or fewer
 * logical cores), unless RAPITAS_VITEST_MAX_WORKERS overrides it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const saved = process.env.RAPITAS_VITEST_MAX_WORKERS;

afterEach(() => {
  if (saved === undefined) delete process.env.RAPITAS_VITEST_MAX_WORKERS;
  else process.env.RAPITAS_VITEST_MAX_WORKERS = saved;
  vi.resetModules();
});

async function loadMaxWorkers(): Promise<unknown> {
  vi.resetModules();
  const mod = await import('../../vitest.config');
  const config = mod.default as { test?: { maxWorkers?: unknown } };
  return config.test?.maxWorkers;
}

describe('vitest.config maxWorkers', () => {
  it('is 2 when RAPITAS_VITEST_MAX_WORKERS is unset', async () => {
    delete process.env.RAPITAS_VITEST_MAX_WORKERS;
    expect(await loadMaxWorkers()).toBe(2);
  });

  it('honours RAPITAS_VITEST_MAX_WORKERS', async () => {
    process.env.RAPITAS_VITEST_MAX_WORKERS = '3';
    expect(await loadMaxWorkers()).toBe(3);
  });
});
