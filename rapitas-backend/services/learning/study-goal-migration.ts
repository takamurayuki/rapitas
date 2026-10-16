/**
 * study-goal-migration
 *
 * One-shot, idempotent startup migration that folds the two legacy goal
 * tables (LearningGoal, ExamGoal) into the unified StudyGoal model and
 * repoints task links (examGoalId → studyGoalId). Legacy rows are never
 * deleted — they stay as a safety net and for legacy imports; idempotency
 * comes from StudyGoal's (legacySource, legacyId) unique pair, so re-running
 * (or importing more legacy rows later) only copies what is missing.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('study-goal-migration');

/**
 * Copy legacy goals into StudyGoal and repoint task references.
 *
 * @returns Number of goals migrated in this run / 今回移行した件数
 */
export async function migrateStudyGoals(): Promise<number> {
  let migrated = 0;
  try {
    // Skill goals (旧 学習目標)
    const learningGoals = await prisma.learningGoal.findMany();
    for (const g of learningGoals) {
      const exists = await prisma.studyGoal.findUnique({
        where: { legacySource_legacyId: { legacySource: 'learning_goal', legacyId: g.id } },
        select: { id: true },
      });
      if (exists) continue;
      await prisma.studyGoal.create({
        data: {
          type: 'skill',
          title: g.title,
          description: g.description,
          deadline: g.deadline,
          status: g.status,
          dailyMinutes: Math.max(5, Math.round((g.dailyHours ?? 1) * 60)),
          categoryId: g.categoryId,
          themeId: g.themeId,
          currentLevel: g.currentLevel,
          targetLevel: g.targetLevel,
          generatedPlan: g.generatedPlan,
          isApplied: g.isApplied,
          legacySource: 'learning_goal',
          legacyId: g.id,
          createdAt: g.createdAt,
        },
      });
      migrated++;
    }

    // Exam goals (旧 試験目標) + task link repointing
    const examGoals = await prisma.examGoal.findMany();
    for (const g of examGoals) {
      let target = await prisma.studyGoal.findUnique({
        where: { legacySource_legacyId: { legacySource: 'exam_goal', legacyId: g.id } },
        select: { id: true },
      });
      if (!target) {
        target = await prisma.studyGoal.create({
          data: {
            type: 'exam',
            title: g.name,
            description: g.description,
            deadline: g.examDate,
            status: g.isCompleted ? 'completed' : 'active',
            color: g.color,
            icon: g.icon,
            targetScore: g.targetScore,
            actualScore: g.actualScore,
            legacySource: 'exam_goal',
            legacyId: g.id,
            createdAt: g.createdAt,
          },
          select: { id: true },
        });
        migrated++;
      }
      // Repoint tasks that still carry only the legacy link (idempotent —
      // only rows whose studyGoalId is unset are touched).
      await prisma.task.updateMany({
        where: { examGoalId: g.id, studyGoalId: null },
        data: { studyGoalId: target.id },
      });
    }

    if (migrated > 0) log.info({ migrated }, 'Legacy goals migrated into StudyGoal');
    return migrated;
  } catch (err) {
    log.error({ err }, 'Study goal migration failed (non-fatal)');
    return migrated;
  }
}
