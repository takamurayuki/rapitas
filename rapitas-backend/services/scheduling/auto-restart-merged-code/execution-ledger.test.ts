/** 台帳の解除漏れを期限と警告で観測できることを固定する。 */
import { beforeEach, expect, mock, test } from 'bun:test';
const warn = mock(() => {});
mock.module('../../../config/logger', () => ({ createLogger: () => ({ warn }) }));
const { registerExecution, getLedgerTaskIds, resetExecutionLedger, LEDGER_ENTRY_MAX_AGE_MS } =
  await import('./execution-ledger');
beforeEach(() => {
  resetExecutionLedger();
  warn.mockClear();
});
test('6時間ちょうどで除外し警告は一度だけ残す', () => {
  registerExecution(51, 1000);
  expect(getLedgerTaskIds(1000 + LEDGER_ENTRY_MAX_AGE_MS - 1)).toEqual([51]);
  expect(warn).not.toHaveBeenCalled();
  expect(getLedgerTaskIds(1000 + LEDGER_ENTRY_MAX_AGE_MS)).toEqual([]);
  expect(getLedgerTaskIds(1001 + LEDGER_ENTRY_MAX_AGE_MS)).toEqual([]);
  expect(warn).toHaveBeenCalledTimes(1);
});
