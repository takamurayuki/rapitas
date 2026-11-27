/**
 * recheck-opponents
 *
 * Who a marked companion is re-checked against before its implementer (task
 * 1572): the other tasks running in its theme and in the other themes on the
 * same repository, minus marked tasks that queued after it (so two waiting
 * tasks never wait on each other), and how each side's planned files are read
 * per workflow mode. Not responsible for judging pairs or recording holds.
 */
import type { ThemeActiveSet } from '../parallel-types';
import type { PeerActiveTask } from '../repository-peers';
import type { RecheckMark } from './recheck-state';

/** A running task the candidate is compared with. */
export interface RecheckOpponent {
  taskId: number;
  sameTheme: boolean;
  /** Time of its own unconsumed mark (ms), null when it carries none. / 相手の印の時刻 */
  markAt: number | null;
}

/**
 * Collect the opponents of `selfId`: its theme's running set (itself
 * excluded) and the repository peers. A failed mark read counts as "no mark",
 * which keeps the opponent (the safe side).
 *
 * @param selfId - The task being re-checked / 確かめ直すタスク
 * @param set - Its theme's running set / 自テーマの動作中集合
 * @param peers - Running tasks of the other themes on the repository / 他テーマの動作中タスク
 * @param readMark - Mark reader / 印の読み取り
 * @returns Opponents with their mark time / 相手一覧
 */
export async function collectRecheckOpponents(
  selfId: number,
  set: ThemeActiveSet,
  peers: PeerActiveTask[],
  readMark: (taskId: number) => Promise<RecheckMark>,
): Promise<RecheckOpponent[]> {
  const own = [
    ...(set.headTaskId != null ? [set.headTaskId] : []),
    ...set.companions.map((c) => c.taskId),
  ];
  const seen = new Set<number>([selfId]);
  const out: RecheckOpponent[] = [];
  const add = async (taskId: number, sameTheme: boolean) => {
    if (seen.has(taskId)) return;
    seen.add(taskId);
    const mark = await readMark(taskId).catch(() => ({ pending: false, markAt: null }));
    out.push({ taskId, sameTheme, markAt: mark.pending ? mark.markAt : null });
  };
  for (const id of own) await add(id, true);
  for (const p of peers) await add(p.taskId, false);
  return out;
}

/**
 * Drop marked opponents that queued after `self`. Order: mark time, then task
 * id. Applied to every opponent regardless of theme, so waits always point
 * from newer to older and can never form a cycle.
 *
 * @param self - The task being re-checked and its mark time / 自分と印の時刻
 * @param opponents - Candidates / 相手一覧
 * @returns Opponents to compare with / 比較する相手
 */
export function dropNewerMarked(
  self: { taskId: number; markAt: number },
  opponents: RecheckOpponent[],
): RecheckOpponent[] {
  return opponents.filter(
    (o) =>
      o.markAt == null ||
      o.markAt < self.markAt ||
      (o.markAt === self.markAt && o.taskId < self.taskId),
  );
}

/** How a task's planned files are read. */
export interface ModeAwareReaderDeps {
  readMode: (taskId: number) => Promise<string | null>;
  readArtifact: (taskId: number, fileType: 'plan' | 'research') => Promise<string | null>;
}

/**
 * Build a memoized plan reader that follows each task's workflow mode:
 * lightweight reads plan.md then research.md (it never writes a plan);
 * standard / comprehensive / unset read plan.md only, because a research.md
 * of a task still planning is not its settled change list.
 *
 * @param deps - Mode and artifact readers / モードと成果物の読み取り
 * @param known - Modes already known (the candidate's) / 既知のモード
 * @returns Reader for buildParallelFilter / 計画の読み取り
 */
export function createModeAwareReader(
  deps: ModeAwareReaderDeps,
  known: Record<number, string | null> = {},
): (taskId: number) => Promise<string | null> {
  const cache = new Map<number, Promise<string | null>>();
  return (taskId) => {
    if (!cache.has(taskId)) {
      cache.set(
        taskId,
        (async () => {
          const mode =
            taskId in known ? known[taskId] : await deps.readMode(taskId).catch(() => null);
          const plan = await deps.readArtifact(taskId, 'plan').catch(() => null);
          if (plan || mode !== 'lightweight') return plan;
          return deps.readArtifact(taskId, 'research').catch(() => null);
        })(),
      );
    }
    return cache.get(taskId)!;
  };
}
