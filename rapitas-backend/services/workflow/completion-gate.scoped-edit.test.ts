/**
 * completion-gate.scoped-edit.test — hasUnresolvedScopedEdit integration
 *
 * task 1060: an unresolved verification-scoped-edit manifest (a temporary
 * live-file edit that never restored) must close the completion gate before
 * the normal diff-based decision runs. Covers only this new branch; the
 * existing has_code_changes / no_changes_unjustified / diff_unavailable
 * branches are covered elsewhere.
 */
import { beforeEach, expect, mock, test } from 'bun:test';

const hasUnresolved = mock((_taskId: number) => false);
mock.module('../agents/verification/verification-scoped-edit', () => ({
  hasUnresolvedScopedEdit: hasUnresolved,
}));
const stubLogger = { info() {}, warn() {}, error() {} };
// Provide BOTH the factory and the `logger` singleton — a transitively
// imported module uses `import { logger }`, which errors if the mock omits it.
mock.module('../../config/logger', () => ({
  createLogger: () => stubLogger,
  logger: stubLogger,
}));

const { evaluateCompletionGate } = await import('./completion-gate');

beforeEach(() => {
  hasUnresolved.mockClear();
  hasUnresolved.mockReturnValue(false);
});

test('unresolved scoped-edit manifest closes the completion gate', async () => {
  hasUnresolved.mockReturnValue(true);
  const result = await evaluateCompletionGate('/task/worktree', 'PASS', undefined, 42);
  expect(result).toEqual({ allow: false, reason: 'unresolved_scoped_edit' });
  expect(hasUnresolved).toHaveBeenCalledWith(42);
});

test('no manifest falls through to the existing diff-based decision', async () => {
  hasUnresolved.mockReturnValue(false);
  const result = await evaluateCompletionGate(null, 'PASS', undefined, 42);
  expect(result.reason).not.toBe('unresolved_scoped_edit');
});

test('omitted supervisionTaskId skips the check entirely (fail-open)', async () => {
  const result = await evaluateCompletionGate(null, 'PASS');
  expect(result.reason).not.toBe('unresolved_scoped_edit');
  expect(hasUnresolved).not.toHaveBeenCalled();
});
