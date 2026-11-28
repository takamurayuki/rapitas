/**
 * overlap-guard-merge-state
 *
 * Decides whether another task's open auto-PR is close enough to merging that
 * the overlap guard should hold an implementer for it. Owns only that
 * judgement and the database read behind it; the hold itself stays in
 * workflow-orchestrator-overlap-guard.ts.
 */

/** Transition causes that record an auto-merge outcome; the latest one decides "parked". */
export const MERGE_OUTCOME_CAUSES = [
  'auto_merged',
  'auto_merge_exhausted',
  'auto_merge_conflict_filed',
] as const;

/**
 * Whether a PR's latest auto-merge outcome leaves it unable to merge on its own.
 *
 * NOTE: "conflict filed" joins "exhausted": the PR conflicts with the base and
 * merges only after the filed resolver task runs — which may be queued behind
 * the very task being held. TempoRaid 1420 and 1418 each sat out the 30-minute
 * ceiling twice on such a PR (#35) on 2026-11-24.
 *
 * @param cause - Latest outcome cause, or undefined when none / 最新の結果、無ければ undefined
 * @returns True when nothing will merge the PR without outside help / 外部の助け無しにマージされないなら true
 */
export function isParkedMergeOutcome(cause: string | undefined): boolean {
  return cause === 'auto_merge_exhausted' || cause === 'auto_merge_conflict_filed';
}

/** Workflow statuses of a task that is still working, so its PR is not about to merge. */
const BACK_AT_WORK = new Set([
  'draft',
  'research_done',
  'plan_created',
  'plan_approved',
  'in_progress',
  'awaiting_question',
]);

/**
 * Whether the PR linked to this task will not merge soon, so it must not hold
 * another implementer.
 *
 * NOTE: A CI repair sends the task back to plan_approved while its PR stays
 * open with a red CI. On 2026-11-28 the guard held 1584 for 1582's PR and 1589
 * for 1585's PR that way, each for most of the 30-minute ceiling, with the head
 * slot idle. Only a task waiting for its merge (verify_done) keeps the hold.
 *
 * @param task - The linked task's status, or null when unreadable / 紐付くタスクの状態（読めなければ null）
 * @param latestOutcome - Latest merge-outcome cause / 最新のマージ結果
 * @returns True when the PR will not merge soon / すぐにはマージされないなら true
 */
export function isLinkedPrUnlikelyToMergeSoon(
  task: { workflowStatus: string | null; status: string } | null,
  latestOutcome: string | undefined,
): boolean {
  if (isParkedMergeOutcome(latestOutcome)) return true;
  if (!task) return false;
  if (task.status === 'blocked') return true;
  return task.workflowStatus != null && BACK_AT_WORK.has(task.workflowStatus);
}

/** The slice of Prisma the reader uses. */
interface MergeStateDb {
  task: {
    findUnique: (args: {
      where: { id: number };
      select: { workflowStatus: true; status: true };
    }) => Promise<{ workflowStatus: string | null; status: string } | null>;
  };
  workflowTransition: {
    findFirst: (args: {
      where: { taskId: number; cause: { in: string[] } };
      orderBy: { createdAt: 'desc' };
      select: { cause: true };
    }) => Promise<{ cause: string } | null>;
  };
}

/**
 * Build the reader the guard uses for "this PR will not merge soon".
 *
 * @param getDb - Resolves the database client lazily / DB クライアントの遅延取得
 * @returns Reader taking the linked task id / 紐付くタスク ID を受け取る読み取り関数
 */
export function makeLinkedPrStateReader(
  getDb: () => Promise<MergeStateDb>,
): (linkedTaskId: number) => Promise<boolean> {
  return async (linkedTaskId) => {
    const db = await getDb();
    const [task, latest] = await Promise.all([
      db.task.findUnique({
        where: { id: linkedTaskId },
        select: { workflowStatus: true, status: true },
      }),
      db.workflowTransition.findFirst({
        where: { taskId: linkedTaskId, cause: { in: [...MERGE_OUTCOME_CAUSES] } },
        orderBy: { createdAt: 'desc' },
        select: { cause: true },
      }),
    ]);
    return isLinkedPrUnlikelyToMergeSoon(task, latest?.cause);
  };
}
