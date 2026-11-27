/**
 * TestParallelism
 *
 * Decides how many test workers the verification gate's test commands may use.
 * Owns only the number; related-tests.ts puts it on the command line.
 *
 * Why: on the 4-logical-core host a verify's test run competed with tsc, the
 * agent CLIs and WebView2 and pegged the CPU at 100% (2026-11-26, task 1553).
 */
import os from 'node:os';

/** Hosts with this many logical cores or fewer count as small. */
export const LOW_CORE_THRESHOLD = 4;
/**
 * Test parallelism on small hosts. 2 keeps one core free for the backend and
 * the UI while still overlapping I/O-bound test files; it also matches the
 * frontend's fixed vitest.config.ts maxWorkers (2).
 */
export const LOW_CORE_TEST_WORKERS = 2;

/** Logical core count, preferring availableParallelism (honours affinity). */
function hostCores(): number {
  return typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
}

/**
 * Test worker cap for the gate's test commands.
 *
 * @param cores - Logical core count (defaults to this host). / 論理コア数
 * @returns 2 on small hosts, null (runner default) otherwise. / 小さい機械では 2、それ以外は null
 */
export function resolveVerifyTestWorkers(cores: number = hostCores()): number | null {
  if (!Number.isFinite(cores) || cores <= LOW_CORE_THRESHOLD) return LOW_CORE_TEST_WORKERS;
  return null;
}
