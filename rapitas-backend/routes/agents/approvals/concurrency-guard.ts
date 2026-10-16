/**
 * Approvals — ConcurrencyGuard
 *
 * Optimistic-concurrency check shared by approve/reject handlers so a client
 * acting on a stale snapshot is rejected instead of silently overwriting.
 * Not responsible for loading approval rows or any status transitions.
 */

import { ConflictError } from '../../../middleware/error-handler';

/**
 * Throw a 409 when the caller's snapshot of the approval is out of date.
 *
 * @param actualUpdatedAt - Stored updatedAt of the approval row / DBの更新時刻
 * @param expectedUpdatedAt - ISO string the client fetched; omitted = no check / クライアント取得時の更新時刻
 * @throws {ConflictError} When expected is given and differs from the stored value / 不一致の場合
 */
export function assertExpectedUpdatedAt(
  actualUpdatedAt: Date,
  expectedUpdatedAt: string | undefined,
): void {
  if (expectedUpdatedAt === undefined) return;
  const expected = new Date(expectedUpdatedAt).getTime();
  if (Number.isNaN(expected) || expected !== actualUpdatedAt.getTime()) {
    throw new ConflictError(
      'Approval request was modified after it was loaded. Reload and retry.',
      'APPROVAL_STALE',
    );
  }
}
