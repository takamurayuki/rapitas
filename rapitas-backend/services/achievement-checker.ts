/**
 * Achievement Checker Service
 * イベントドリブンで実績の自動解除を行う
 */
import { prisma } from "../config/database";
import { notifyAchievementUnlocked } from "./notification-service";

type AchievementEvent =
  | "task.completed"
  | "streak.updated"
  | "study.logged"
  | "exam.completed"
  | "flashcard.reviewed"
  | "pomodoro.completed";

/**
 * イベント発生時に実績チェックを実行
 * 非同期でfire-and-forget（呼び出し元をブロックしない）
 */
export async function checkAchievements(event: AchievementEvent): Promise<void> {
  try {
    const achievements = await prisma.achievement.findMany({
      include: { unlockedBy: true },
    });

    const unlockedIds = new Set(
      achievements
        .filter((a) => a.unlockedBy.length > 0)
        .map((a) => a.id)
    );

    // イベントに関連する条件タイプのみチェック
    const relevantTypes = getRelevantConditionTypes(event);

    for (const achievement of achievements) {
      if (unlockedIds.has(achievement.id)) continue;

      const condition = JSON.parse(achievement.condition) as {
        type: string;
        count?: number;
        days?: number;
        hours?: number;
      };

      if (!relevantTypes.includes(condition.type)) continue;

      const shouldUnlock = await evaluateCondition(condition);

      if (shouldUnlock) {
        // 既に解除されていないか再確認（レースコンディション防止）
        const existing = await prisma.userAchievement.findUnique({
          where: { achievementId: achievement.id },
        });

        if (!existing) {
          await prisma.userAchievement.create({
            data: { achievementId: achievement.id },
          });

          // 通知送信
          await notifyAchievementUnlocked(achievement.name, achievement.icon);

          console.log(`[Achievement] Unlocked: ${achievement.name}`);
        }
      }
    }
  } catch (error) {
    console.error("[Achievement] Check failed:", error);
  }
}

function getRelevantConditionTypes(event: AchievementEvent): string[] {
  switch (event) {
    case "task.completed":
      return ["tasks_completed"];
    case "streak.updated":
      return ["streak"];
    case "study.logged":
      return ["study_hours", "early_study", "night_study"];
    case "exam.completed":
      return ["exam_completed"];
    case "flashcard.reviewed":
      return ["flashcard_reviews"];
    case "pomodoro.completed":
      return ["study_hours"]; // ポモドーロ完了も学習時間に寄与
    default:
      return [];
  }
}

async function evaluateCondition(condition: {
  type: string;
  count?: number;
  days?: number;
  hours?: number;
}): Promise<boolean> {
  switch (condition.type) {
    case "tasks_completed": {
      const count = await prisma.task.count({
        where: { status: "done", parentId: null },
      });
      return count >= (condition.count || 0);
    }

    case "streak": {
      // StudyStreakから連続日数を計算
      const streaks = await prisma.studyStreak.findMany({
        where: {
          OR: [
            { studyMinutes: { gt: 0 } },
            { tasksCompleted: { gt: 0 } },
          ],
        },
        orderBy: { date: "desc" },
        take: (condition.days || 0) + 1,
      });

      if (streaks.length < (condition.days || 0)) return false;

      // 連続日数チェック
      let consecutive = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (let i = 0; i < streaks.length; i++) {
        const expectedDate = new Date(today);
        expectedDate.setDate(expectedDate.getDate() - i);
        expectedDate.setHours(0, 0, 0, 0);

        const streakDate = new Date(streaks[i]!.date);
        streakDate.setHours(0, 0, 0, 0);

        if (streakDate.getTime() === expectedDate.getTime()) {
          consecutive++;
        } else {
          break;
        }
      }

      return consecutive >= (condition.days || 0);
    }

    case "study_hours": {
      const timeEntries = await prisma.timeEntry.findMany();
      const totalHours = timeEntries.reduce(
        (sum: number, e: { duration: number }) => sum + e.duration,
        0
      );
      return totalHours >= (condition.hours || 0);
    }

    case "exam_completed": {
      const count = await prisma.examGoal.count({
        where: { isCompleted: true },
      });
      return count >= (condition.count || 0);
    }

    case "flashcard_reviews": {
      const result = await prisma.flashcard.aggregate({
        _sum: { reviewCount: true },
      });
      return (result._sum.reviewCount || 0) >= (condition.count || 0);
    }

    case "early_study": {
      const hour = new Date().getHours();
      if (hour >= 6) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStreak = await prisma.studyStreak.findFirst({
        where: {
          date: { gte: today },
          OR: [
            { studyMinutes: { gt: 0 } },
            { tasksCompleted: { gt: 0 } },
          ],
        },
      });
      return !!todayStreak;
    }

    case "night_study": {
      const hour = new Date().getHours();
      if (hour >= 4) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStreak = await prisma.studyStreak.findFirst({
        where: {
          date: { gte: today },
          OR: [
            { studyMinutes: { gt: 0 } },
            { tasksCompleted: { gt: 0 } },
          ],
        },
      });
      return !!todayStreak;
    }

    default:
      return false;
  }
}
