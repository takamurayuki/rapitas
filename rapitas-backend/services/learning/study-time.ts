/**
 * study-time
 *
 * Records blocks of study time: one StudySession row plus the matching
 * StudyStreak daily-aggregate increment, so every existing streak consumer
 * (dashboard, statistics, roadmap analytics) stays in sync no matter which
 * source recorded the time (manual log, pomodoro, vocab review).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const logger = createLogger('study-time');

export type StudySource = 'manual' | 'pomodoro' | 'vocab';

export interface RecordStudySessionInput {
  minutes: number;
  goalId?: number | null;
  source?: StudySource;
  note?: string | null;
  studiedAt?: Date;
  pomodoroSessionId?: number | null;
}

/** Local midnight of a timestamp — same day convention as /study-streaks/record. */
const localDayStart = (d: Date): Date => {
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  return day;
};

/**
 * Record one study block and bump that day's StudyStreak minutes.
 *
 * When `pomodoroSessionId` is set, this upserts the StudySession row keyed on
 * that id instead of always creating a new one — a mid-session checkpoint
 * followed by the completion record must overwrite the same row rather than
 * accumulate two, since both represent the same pomodoro's study time.
 *
 * @param input - Minutes (rounded, must be >= 1 after rounding), optional goal attribution, source, note, timestamp, pomodoro dedup key / 分数・目標・記録元・メモ・日時・ポモドーロ重複防止キー
 * @returns The created or updated StudySession row / 作成または更新された学習セッション行
 * @throws {Error} When minutes rounds to zero or below / 分数が0以下の場合
 */
export async function recordStudySession(input: RecordStudySessionInput) {
  const minutes = Math.round(input.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error('学習時間(分)は1以上で指定してください');
  }
  const studiedAt = input.studiedAt ?? new Date();
  const day = localDayStart(studiedAt);
  const pomodoroSessionId = input.pomodoroSessionId ?? null;

  if (pomodoroSessionId == null) {
    const [session] = await prisma.$transaction([
      prisma.studySession.create({
        data: {
          minutes,
          goalId: input.goalId ?? null,
          source: input.source ?? 'manual',
          note: input.note ?? null,
          studiedAt,
          pomodoroSessionId: null,
        },
      }),
      prisma.studyStreak.upsert({
        where: { date: day },
        update: { studyMinutes: { increment: minutes } },
        create: { date: day, studyMinutes: minutes, tasksCompleted: 0 },
      }),
    ]);
    return session;
  }

  // Same pomodoroSessionId as an earlier checkpoint/completion: overwrite its
  // minutes (upsert.update) and apply only the delta to the streak, so the
  // day's aggregate reflects the latest total instead of double-counting.
  const existing = await prisma.studySession.findUnique({ where: { pomodoroSessionId } });
  const delta = minutes - (existing?.minutes ?? 0);

  const [session] = await prisma.$transaction([
    prisma.studySession.upsert({
      where: { pomodoroSessionId },
      create: {
        minutes,
        goalId: input.goalId ?? null,
        source: input.source ?? 'manual',
        note: input.note ?? null,
        studiedAt,
        pomodoroSessionId,
      },
      update: { minutes, studiedAt },
    }),
    prisma.studyStreak.upsert({
      where: { date: day },
      update: { studyMinutes: { increment: delta } },
      create: { date: day, studyMinutes: Math.max(delta, 0), tasksCompleted: 0 },
    }),
  ]);
  return session;
}

/**
 * Delete a study block and remove its minutes from that day's aggregate.
 *
 * @param id - StudySession id / 削除対象ID
 * @returns The deleted row, or null when it does not exist / 削除行(無ければnull)
 */
export async function deleteStudySession(id: number) {
  const session = await prisma.studySession.findUnique({ where: { id } });
  if (!session) return null;
  const day = localDayStart(session.studiedAt);
  await prisma.$transaction([
    prisma.studySession.delete({ where: { id } }),
    prisma.studyStreak.updateMany({
      where: { date: day },
      data: { studyMinutes: { decrement: session.minutes } },
    }),
  ]);
  // The streak row may have pre-session minutes recorded through other paths;
  // clamp instead of trusting the decrement never to cross zero.
  await prisma.studyStreak.updateMany({
    where: { date: day, studyMinutes: { lt: 0 } },
    data: { studyMinutes: 0 },
  });
  return session;
}

export interface RecordPomodoroStudyTimeInput {
  taskId: number;
  pomodoroSessionId: number;
  durationSeconds: number;
}

/**
 * Resolve which StudyGoal (if any) a completed work pomodoro should credit,
 * then record the study time. Direct task-to-goal linking (Task.studyGoalId)
 * takes priority over theme-based linking (Task.themeId -> StudyGoal.themeId,
 * oldest active goal only — see plan.md "目標解決ロジック"). Best-effort: any
 * failure is logged and swallowed so it never blocks pomodoro completion.
 *
 * @param input - Task id, the completed PomodoroSession id (dedup key), and its duration in seconds / タスクID・ポモドーロセッションID・秒数
 */
/**
 * Resolve the study goal a task's work time should credit: the task's own
 * studyGoalId, else its theme's active goal, else the same two lookups on the
 * PARENT task (subtasks usually carry neither field themselves).
 *
 * @param taskId - Task or subtask id / タスクまたはサブタスクのID
 * @returns The goal id, or null when nothing is linked / 紐づく目標ID(なければnull)
 */
export async function resolveStudyGoalIdForTask(taskId: number): Promise<number | null> {
  const themeGoal = async (themeId: number | null): Promise<number | null> => {
    if (!themeId) return null;
    const goal = await prisma.studyGoal.findFirst({
      where: { themeId, status: 'active' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return goal?.id ?? null;
  };

  // NOTE: resolver boundary contract (gen-resolver-boundary-tests) — a DB
  // failure resolves to null rather than rejecting; every caller treats the
  // goal lookup as best-effort, and the generated boundary test pins this.
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { studyGoalId: true, themeId: true, parentId: true },
    });
    if (!task) return null;

    const own = task.studyGoalId ?? (await themeGoal(task.themeId));
    if (own || !task.parentId) return own;

    const parent = await prisma.task.findUnique({
      where: { id: task.parentId },
      select: { studyGoalId: true, themeId: true },
    });
    if (!parent) return null;
    return parent.studyGoalId ?? (await themeGoal(parent.themeId));
  } catch (error) {
    logger.warn({ error, taskId }, 'Failed to resolve study goal for task');
    return null;
  }
}

/**
 * Auto-record study time for work time registered on a (possibly subtask)
 * task of a goal-linked theme (operator request 2026-09-03). Pomodoro-driven
 * time entries must NOT come through here — the pomodoro session path
 * already records the same minutes keyed by pomodoroSessionId.
 *
 * @param input - Task id and worked hours / タスクIDと作業時間(時間)
 */
export async function recordTaskWorkStudyTime(input: {
  taskId: number;
  durationHours: number;
}): Promise<void> {
  try {
    const goalId = await resolveStudyGoalIdForTask(input.taskId);
    if (!goalId) return;
    // Minutes are rounded UP — same convention as the pomodoro path.
    const minutes = Math.ceil(input.durationHours * 60);
    if (minutes < 1) return;
    await recordStudySession({ minutes, goalId, source: 'manual' });
  } catch (error) {
    logger.warn({ error, taskId: input.taskId }, 'Failed to auto-record task work study time');
  }
}

export async function recordPomodoroStudyTime(input: RecordPomodoroStudyTimeInput): Promise<void> {
  try {
    const goalId = await resolveStudyGoalIdForTask(input.taskId);
    if (!goalId) return;

    const minutes = Math.ceil(input.durationSeconds / 60);
    if (minutes < 1) return;

    await recordStudySession({
      minutes,
      goalId,
      source: 'pomodoro',
      pomodoroSessionId: input.pomodoroSessionId,
    });
  } catch (error) {
    logger.warn(
      { error, taskId: input.taskId, pomodoroSessionId: input.pomodoroSessionId },
      'Failed to auto-record pomodoro study time',
    );
  }
}
