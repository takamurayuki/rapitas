/**
 * log-health-check causal-analysis wiring tests
 *
 * Verifies the daily health check invokes the causal suggestion filer, adds its count to
 * the filed total, and still completes when the filer yields nothing.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

mock.module('fs/promises', () => ({ readFile: () => Promise.resolve('') }));
mock.module('./log-tail-reader', () => ({ readLogTail: () => Promise.resolve('') }));
mock.module('fs', () => ({
  readdirSync: () => [],
  statSync: () => ({ isFile: () => false, mtimeMs: 0 }),
  existsSync: () => false,
  unlinkSync: () => {},
}));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLog,
  getBackendLogFilePath: () => '/nonexistent/backend.log',
}));
mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: { theme: { findMany: () => Promise.resolve([]) } },
}));
mock.module('../memory/concern-backlog-service', () => ({
  submitConcern: () => Promise.resolve(undefined),
  resolveDefaultThemeId: () => Promise.resolve(5),
}));
mock.module('../scheduling/theme-backlog-override-service', () => ({
  getHealthCheckTargets: () => Promise.resolve([]),
}));

const mockFileCausal = mock((_themeId?: number): Promise<number> => Promise.resolve(0));
mock.module('../workflow/causal-analysis/causal-suggestion-filer', () => ({
  fileCausalSuggestions: mockFileCausal,
}));

const { runLogHealthCheck } = await import('./log-health-check');

describe('runLogHealthCheck causal wiring', () => {
  beforeEach(() => mockFileCausal.mockReset());

  it('calls the causal filer with the default theme and adds its count to the total', async () => {
    mockFileCausal.mockResolvedValue(2);
    const filed = await runLogHealthCheck();
    expect(mockFileCausal).toHaveBeenCalledTimes(1);
    expect(mockFileCausal.mock.calls[0][0]).toBe(5);
    expect(filed).toBe(2);
  });

  it('completes with zero filed when no cascade is found', async () => {
    mockFileCausal.mockResolvedValue(0);
    expect(await runLogHealthCheck()).toBe(0);
  });
});
