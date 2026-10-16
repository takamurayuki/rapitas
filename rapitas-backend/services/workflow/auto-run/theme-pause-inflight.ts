/**
 * theme-pause-inflight
 *
 * What a pause did NOT stop. Owns only the description: it never pauses,
 * stops, kills or releases anything — theme-auto-run-service.ts pauses and
 * stop-task-agents.ts kills.
 *
 * Why this exists. `action: 'pause'` stops the next selection and nothing
 * else: a repair cycle already dispatched runs to completion, and the task's
 * WorkflowQueueItem keeps holding its concurrency slot. The route answered
 * with `status: paused` alone, so both were invisible. Both have cost real
 * incidents — executions #5812 and #5819 started after #1214 was paused
 * (2026-10-13), and a paused theme's retained queue item starved every theme
 * at MAX_CONCURRENCY=1 until the item itself was cancelled.
 */
import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';

const log = createLogger('workflow:theme-pause-inflight');

/**
 * Execution statuses that mean "still occupying the system". `pending` counts:
 * a dispatched-but-unstarted execution will start, so reporting it as not
 * running is the same mistake in slower motion.
 */
export const IN_FLIGHT_EXECUTION_STATUSES = ['running', 'pending', 'waiting_for_input'] as const;

/**
 * Queue status that holds a concurrency slot — exactly one. The gate is
 * `count({ status: 'running' }) >= maxConcurrency` in workflow-queue.ts's
 * dequeue, so `waiting_approval` and `queued` do NOT hold a slot and listing
 * them here would overstate what the pause is blocking. Verified against the
 * live DB: of 4,288 queue rows, the statuses present are queued / completed /
 * failed / cancelled — 'running' is transient, which is why it has to be read
 * at pause time rather than inferred later.
 */
const SLOT_HOLDING_QUEUE_STATUSES = ['running'] as const;

/** One execution that the pause did not stop. */
export interface InFlightExecution {
  executionId: number;
  taskId: number | null;
  status: string;
  startedAt: Date | null;
}

/** One queue item still holding a slot. */
export interface HeldQueueItem {
  id: number;
  taskId: number;
  status: string;
}

/** What a pause left running. */
export interface PauseScope {
  stillRunning: InFlightExecution[];
  heldQueueItems: HeldQueueItem[];
  /** True when a read failed, so the lists are INCOMPLETE rather than empty. / 読み取り失敗 */
  unknown: boolean;
  /** Plain-language scope of the pause, for the API response. / 応答に載せる説明 */
  note: string;
}

const BASE_NOTE =
  'pause は次の選定を止めます。すでに走っている修復サイクルは完走し、タスクの' +
  'WorkflowQueueItem は枠を握ったままです。走っているものを止めるには action:stop ' +
  '（エージェントを kill し worktree を削除するため、未コミットの実装は失われます）。';

const UNKNOWN_NOTE =
  ' なお、実行中の一覧は読み取りに失敗したため確認できません（空でも「無し」ではありません）。';

/**
 * Describe what remains in flight for a theme after a pause.
 *
 * A failed read sets `unknown` instead of returning an empty list: reporting
 * "nothing is running" because the query failed is the exact misreading this
 * module exists to prevent.
 *
 * @param themeId - Theme that was paused. / 対象テーマ
 * @returns The executions and queue items the pause did not stop. / pauseが止めなかったもの
 */
export async function describePauseScope(themeId: number): Promise<PauseScope> {
  let unknown = false;

  const executions = await prisma.agentExecution
    .findMany({
      where: {
        status: { in: [...IN_FLIGHT_EXECUTION_STATUSES] },
        session: { config: { task: { themeId } } },
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        session: { select: { config: { select: { taskId: true } } } },
      },
    })
    .catch((err: unknown) => {
      log.warn({ err, themeId }, '[pause-scope] in-flight execution read failed');
      unknown = true;
      return [] as {
        id: number;
        status: string;
        startedAt: Date | null;
        session: { config: { taskId: number | null } | null } | null;
      }[];
    });

  const queueItems = await prisma.workflowQueueItem
    .findMany({
      where: { themeId, status: { in: [...SLOT_HOLDING_QUEUE_STATUSES] } },
      select: { id: true, taskId: true, status: true },
    })
    .catch((err: unknown) => {
      log.warn({ err, themeId }, '[pause-scope] queue item read failed');
      unknown = true;
      return [] as HeldQueueItem[];
    });

  return {
    stillRunning: executions.map((e) => ({
      executionId: e.id,
      taskId: e.session?.config?.taskId ?? null,
      status: e.status,
      startedAt: e.startedAt,
    })),
    heldQueueItems: queueItems,
    unknown,
    note: unknown ? BASE_NOTE + UNKNOWN_NOTE : BASE_NOTE,
  };
}
