/**
 * auto-merge-checks fail-closed test
 *
 * #1410: when .github/quality-gates.json cannot be read, blockingChecks()
 * returns null (the watcher then merges nothing) and logs why — it must never
 * fall back to an empty or stale list. The explicit env override still wins.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';

// Mirrors every export of quality-gates-definition (bun mock.module replaces the whole module).
mock.module('./quality-gates-definition', () => ({
  QUALITY_GATES_FILE: '/nowhere/.github/quality-gates.json',
  loadQualityGateBlockingChecks: () => ({
    ok: false,
    reason: 'cannot read /nowhere/.github/quality-gates.json: ENOENT',
  }),
}));
const logError = mock(() => {});
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: logError }),
}));

const { blockingChecks } = await import('./auto-merge-checks');

afterEach(() => {
  delete process.env.RAPITAS_AUTOMERGE_CHECKS;
  logError.mockClear();
});

describe('blockingChecks — gates definition unavailable', () => {
  it('returns null and logs the reason instead of a fallback list', () => {
    expect(blockingChecks()).toBeNull();
    expect(logError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logError.mock.calls[0])).toContain('ENOENT');
  });

  it('an explicit RAPITAS_AUTOMERGE_CHECKS override still applies', () => {
    process.env.RAPITAS_AUTOMERGE_CHECKS = 'Lint Code';
    expect(blockingChecks()).toEqual(new Set(['Lint Code']));
    expect(logError).not.toHaveBeenCalled();
  });
});
