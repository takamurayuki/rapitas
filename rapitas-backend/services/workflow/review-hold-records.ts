/**
 * review-hold-records
 *
 * The records around a review hold: parsing a hold transition's metadata, the
 * timeline copy of a hold / its resolution, and the target a human override
 * is bound to (verify.md sha256 + publish worktree + git tree id) together
 * with the check that the current state still is that target. Not
 * responsible for writing or clearing the hold itself (review-hold.ts).
 *
 * NOTE: Moved out of review-hold.ts so that file stays under the 300-line
 * limit when the override binding was added.
 */
import { createLogger } from '../../config/logger';

const log = createLogger('workflow:review-hold');

/**
 * What a human override of a review hold covers, recorded on the resolution:
 * the verify.md version, the worktree publication runs in, and the git tree
 * the commit records (commit-stable, unlike the diff fingerprint, so it still
 * identifies the work after the commit — see workflow-auto-commit-tree-identity).
 */
export interface OverrideTarget {
  verifySha256: string;
  treeId: string;
  worktreePath: string;
}

/**
 * Parse transition metadata (stored as a JSON string or an object). Never throws.
 *
 * @param raw - Stored metadata / 保存されたメタデータ
 * @returns The object, or {} when it is not one / オブジェクト（無ければ {}）
 */
export function parseHoldMetadata(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw) as unknown;
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/**
 * The override target recorded on a resolution, or null when absent/malformed.
 *
 * @param meta - Parsed resolution metadata / 解消記録のメタデータ
 * @returns The recorded target, or null / 記録された対象（無ければ null）
 */
export function readOverrideTarget(meta: Record<string, unknown>): OverrideTarget | null {
  const b = meta.binding as Record<string, unknown> | undefined;
  if (!b || typeof b !== 'object') return null;
  const { verifySha256, treeId, worktreePath } = b;
  if (typeof verifySha256 !== 'string' || !verifySha256) return null;
  if (typeof treeId !== 'string' || !treeId) return null;
  if (typeof worktreePath !== 'string' || !worktreePath) return null;
  return { verifySha256, treeId, worktreePath };
}

/**
 * The current override target of a task — what an override given now would be
 * bound to — or what could not be read. Never throws.
 *
 * @param taskId - Task id / タスクID
 * @returns The target, or { missing } naming the unreadable identifier / 現在の対象、または読めなかった識別子
 */
export async function readCurrentOverrideTarget(
  taskId: number,
): Promise<OverrideTarget | { missing: string }> {
  try {
    const [{ readVerifySha256 }, { resolvePublishWorktree }, { stagedTreeIdentity }] =
      await Promise.all([
        import('./verify-jury-completion'),
        import('./publish/workflow-auto-commit-binding'),
        import('./publish/workflow-auto-commit-tree-identity'),
      ]);
    // NOTE: The SAME worktree commit/PR publishes from (latest-active session).
    const worktreePath = await resolvePublishWorktree(taskId);
    if (!worktreePath) return { missing: '公開処理が使う worktree が見つかりません' };
    const verifySha256 = await readVerifySha256(taskId);
    if (!verifySha256) return { missing: 'verify.md の識別子（sha256）を取得できません' };
    const treeId = await stagedTreeIdentity(worktreePath);
    if (!treeId) return { missing: '差分の識別子（tree）を取得できません' };
    return { verifySha256, treeId, worktreePath };
  } catch (err) {
    log.warn({ err, taskId }, '[review-hold] Override target unreadable');
    return { missing: '上書きの対象を読み取れません' };
  }
}

/**
 * Why the task's current state is no longer what an override was bound to, or
 * null when it still is. Unreadable identifiers count as a mismatch. Never throws.
 *
 * @param taskId - Task id / タスクID
 * @param target - Target recorded on the override / 上書きの対象
 * @returns Mismatch reason, or null when it still matches / 不一致の理由（一致なら null）
 */
export async function overrideTargetDrift(
  taskId: number,
  target: OverrideTarget,
): Promise<string | null> {
  const now = await readCurrentOverrideTarget(taskId);
  if ('missing' in now) return now.missing;
  if (now.worktreePath !== target.worktreePath)
    return '公開に使う worktree が上書きの対象と異なります';
  if (now.verifySha256 !== target.verifySha256) return '上書きした後に verify.md が変わりました';
  if (now.treeId !== target.treeId) return '上書きした後に差分が変わりました';
  return null;
}

/**
 * Timeline copy of the hold and its resolution: the desktop review history
 * reads the timeline (GET /memory/timeline), not WorkflowTransition. Never throws.
 *
 * @param eventType - Hold or resolution / 保留か解消か
 * @param taskId - Task id / タスクID
 * @param payload - Event payload / ペイロード
 */
export async function appendHoldEvent(
  eventType: 'review_hold' | 'review_hold_resolved',
  taskId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const { appendEvent } = await import('../memory/timeline');
    await appendEvent({
      eventType,
      actorType: eventType === 'review_hold' ? 'system' : 'user',
      payload: { taskId, ...payload },
      correlationId: `task-${taskId}`,
    });
  } catch (err) {
    log.warn({ err, taskId, eventType }, '[review-hold] Failed to append timeline event');
  }
}
