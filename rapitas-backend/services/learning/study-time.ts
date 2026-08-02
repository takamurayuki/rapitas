/**
 * study-time
 *
 * Records blocks of study time: one StudySession row plus the matching
 * StudyStreak daily-aggregate increment, so every existing streak consumer
 * (dashboard, statistics, roadmap analytics) stays in sync no matter which
 * source recorded the time (manual log, pomodoro, vocab review).
 */
import { prisma } from '../../config/database';

export type StudySource = 'manual' | 'pomodoro' | 'vocab';

export interface RecordStudySessionInput {
  minutes: number;
  goalId?: number | null;
  source?: StudySource;
  note?: string | null;
  studiedAt?: Date;
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
 * @param input - Minutes (rounded, must be >= 1 after rounding), optional goal attribution, source, note, timestamp / 分数・目標・記録元・メモ・日時
 * @returns The created StudySession row / 作成された学習セッション行
 * @throws {Error} When minutes rounds to zero or below / 分数が0以下の場合
 */
export async function recordStudySession(input: RecordStudySessionInput) {
  const minutes = Math.round(input.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error('学習時間(分)は1以上で指定してください');
  }
  const studiedAt = input.studiedAt ?? new Date();
  const [session] = await prisma.$transaction([
    prisma.studySession.create({
      data: {
        minutes,
        goalId: input.goalId ?? null,
        source: input.source ?? 'manual',
        note: input.note ?? null,
        studiedAt,
      },
    }),
    prisma.studyStreak.upsert({
      where: { date: localDayStart(studiedAt) },
      update: { studyMinutes: { increment: minutes } },
      create: { date: localDayStart(studiedAt), studyMinutes: minutes, tasksCompleted: 0 },
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
