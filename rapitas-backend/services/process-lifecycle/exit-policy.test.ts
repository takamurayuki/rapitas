/**
 * exit-policy.test
 *
 * The backend must never end with exit code 0 after a failure: dev.js reads 0
 * as "stopped on purpose" and does not bring it back. On 2026-11-07 a merged
 * dependency (qrcode) was missing from node_modules, the entry import failed,
 * and the backend stayed down silently until a person noticed.
 */
import { describe, it, expect, mock } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runServerEntry, exitCodeForShutdown } from './exit-policy';

describe('runServerEntry', () => {
  it('exits 1 when the entry fails to load', async () => {
    const exit = mock((_code: number) => undefined);
    const report = mock((_err: unknown) => undefined);
    const failure = new Error("Cannot find package 'qrcode'");

    await runServerEntry(() => Promise.reject(failure), { exit, report });

    expect(report).toHaveBeenCalledWith(failure);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 in a real process whose uncaughtException listener would swallow it', async () => {
    // The production failure: a listener is registered (error-handler.ts), the
    // dynamic import fails, and without the wrapper Bun neither exits non-zero
    // nor keeps serving.
    const dir = mkdtempSync(join(tmpdir(), 'exit-policy-'));
    try {
      const policy = join(import.meta.dir, 'exit-policy.ts').replaceAll('\\', '/');
      writeFileSync(join(dir, 'broken.ts'), "import 'no-such-package-exit-policy';\n");
      writeFileSync(
        join(dir, 'entry.ts'),
        [
          `import { runServerEntry } from '${policy}';`,
          "process.on('uncaughtException', () => {});",
          "await runServerEntry(() => import('./broken.ts'), {",
          '  exit: (code) => process.exit(code),',
          '  report: () => {},',
          '});',
          '',
        ].join('\n'),
      );
      const proc = Bun.spawn([process.execPath, join(dir, 'entry.ts')], {
        stdout: 'ignore',
        stderr: 'ignore',
      });
      const timer = setTimeout(() => proc.kill(), 15_000);
      const code = await proc.exited;
      clearTimeout(timer);
      expect(code).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it('does not exit when the entry loads', async () => {
    const exit = mock((_code: number) => undefined);

    await runServerEntry(() => Promise.resolve(), { exit, report: () => undefined });

    expect(exit).not.toHaveBeenCalled();
  });
});

describe('exitCodeForShutdown', () => {
  it('reports a crash as a failure so the supervisor restarts it', () => {
    expect(exitCodeForShutdown('uncaughtException')).toBe(1);
  });

  it.each(['SIGTERM', 'SIGINT', 'SIGBREAK', 'SIGHUP', 'parent-exit'])(
    'keeps a requested stop (%s) as a clean exit',
    (signal) => {
      expect(exitCodeForShutdown(signal)).toBe(0);
    },
  );
});
