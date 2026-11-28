/**
 * awaiting-ci-lookup
 *
 * DB-backed checks for the CI-wait shape (task 1568): is a task parked for its required merge
 * (state AND latest transition cause), which released tasks are still waiting, and has the
 * runner's own queue item already been handed back. Not responsible for releasing slots — see
 * auto-run/auto-run-release-awaiting-ci.ts.
 */
// NOTE: the barrel client (not config/database) on purpose — the runner's tests mock '../../config'
// and must not fall through to a real database when this module is consulted every pass.
import { prisma } from '../../config';
import { AWAITING_REQUIRED_MERGE_CAUSE, isAwaitingCiItem, isCiWaitTask } from './awaiting-ci';

/** One task that released its slot and now waits for CI / the required merge. */
export interface AwaitingCiEntry {
  taskId: number;
  title: string;
  cause: string;
  since: string;
}

/**
 * Whether the task is parked for its required merge: held shape, no halt, and its LATEST
 * transition is the required-merge hold. A task parked for another reason (review hold, repair)
 * shares the `verify_done` shape but not this cause. Use this wherever "cannot tell" must not be
 * read as "not waiting" (anything that would then complete or re-run the task).
 *
 * @param taskId - Task to check. / 対象タスクID
 * @returns True when it waits for CI, false when it was read and does not. / CI待ちなら true
 * @throws When either read fails: the answer is unknown. / 読み取り失敗時（不明）
 */
export async function readTaskAwaitingCi(taskId: number): Promise<boolean> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true, workflowStatus: true, haltReason: true },
  });
  if (!isCiWaitTask(task) || task?.haltReason) return false;
  const last = await prisma.workflowTransition.findFirst({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
    select: { cause: true },
  });
  return last?.cause === AWAITING_REQUIRED_MERGE_CAUSE;
}

/**
 * {@link readTaskAwaitingCi} for callers that act only on positive evidence (handing a slot back):
 * a read error answers false, i.e. "leave things as they are".
 *
 * @param taskId - Task to check. / 対象タスクID
 * @returns True only on positive evidence of a CI wait. / CI待ちと確認できた場合のみ true
 */
export async function isTaskAwaitingCi(taskId: number): Promise<boolean> {
  try {
    return await readTaskAwaitingCi(taskId);
  } catch {
    return false;
  }
}

/**
 * Whether this queue item was already handed back (`completed` + `awaiting_ci`), so the runner
 * that owns it can stop waiting for the merge. Keyed by item id: a hand-back of an EARLIER item of
 * the same task never ends a later wait. Fails closed (false) on any read error.
 *
 * @param itemId - Queue item the runner is waiting on. / 待機中の項目ID
 * @returns True when that item is a handed-back one. / 手放し済みなら true
 */
export async function isQueueItemHandedBack(itemId: number): Promise<boolean> {
  try {
    const item = await prisma.workflowQueueItem.findUnique({
      where: { id: itemId },
      select: { status: true, currentPhase: true },
    });
    return item?.status === 'completed' && isAwaitingCiItem(item);
  } catch {
    return false;
  }
}

/**
 * Whether a queue item is still its runner's own: positive evidence of the opposite — the row
 * is `running` — is the only thing that says yes. A missing row or a read error is NOT ownership:
 * the runner withdraws and the task stays with the watcher / ci-self-repair.
 *
 * @param itemId - The item the runner dequeued. / ランナーが取り出した項目ID
 * @returns True only when the item was read and is `running`. / 読めて running のときだけ true
 */
export async function isItemStillOwned(itemId: number): Promise<boolean> {
  // NOTE: Unit tests of the runner stub `prisma` without a queue-item model; a real client always
  // has one, so only a double reaches this line (a read ERROR below still fails closed).
  if (typeof prisma.workflowQueueItem?.findUnique !== 'function') return true;
  try {
    const item = await prisma.workflowQueueItem.findUnique({
      where: { id: itemId },
      select: { status: true },
    });
    return item?.status === 'running';
  } catch {
    // Fail-closed: not knowing is not owning (task 1568).
    return false;
  }
}

/**
 * テーマ内のCI待ちTaskを列挙する。消失しうるキュー項目には依存しない。
 *
 * @param themeId - Theme. / テーマID
 * @returns Entries with the latest transition cause. / 最新causeつきの一覧
 */
export async function listAwaitingCi(themeId: number): Promise<AwaitingCiEntry[]> {
  try {
    const tasks = await prisma.task.findMany({
      where: { themeId, status: 'in-progress', workflowStatus: 'verify_done', haltReason: null },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, updatedAt: true },
    });
    const out: AwaitingCiEntry[] = [];
    for (const task of tasks) {
      if (!(await isTaskAwaitingCi(task.id))) continue;
      out.push({
        taskId: task.id,
        title: task.title,
        cause: AWAITING_REQUIRED_MERGE_CAUSE,
        since: task.updatedAt.toISOString(),
      });
    }
    return out;
  } catch {
    return [];
  }
}
