/**
 * verification-gate.spec-allowlist.test
 *
 * Plan-less tasks may declare protected-path TEST files in their spec; only
 * those (never production gate code) reach the tamper allowlist.
 */
import { describe, test, expect, mock } from 'bun:test';

mock.module('../../../config/database', () => ({
  prisma: {},
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../config/logger', () => {
  const noop = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
  };
  return {
    createLogger: () => noop,
    logger: noop,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

const { protectedTestPathsFromSpec } = await import('./verification-gate');

describe('protectedTestPathsFromSpec', () => {
  test('keeps only *.test.ts paths named in the spec', () => {
    const spec = [
      '対象: `rapitas-backend/services/agents/verification/runtime-smoke/runtime-smoke.test.ts` (1 fail)',
      '`bun test services/agents/orchestrator/stale-execution-recovery.test.ts` が 0 fail',
      '`services/agents/verification/verification-gate.ts` は変更しない',
      '`.github/workflows/test-lint.yml`',
    ].join('\n');
    const paths = protectedTestPathsFromSpec(spec);
    expect(paths).toContain(
      'rapitas-backend/services/agents/verification/runtime-smoke/runtime-smoke.test.ts',
    );
    expect(paths).toContain('services/agents/orchestrator/stale-execution-recovery.test.ts');
    expect(paths.some((p) => p.endsWith('verification-gate.ts'))).toBe(false);
    expect(paths.some((p) => p.endsWith('.yml'))).toBe(false);
  });

  test('returns nothing for a spec without test paths', () => {
    expect(protectedTestPathsFromSpec('通知の読み込みを速くする')).toEqual([]);
  });
});
