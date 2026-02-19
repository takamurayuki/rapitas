/**
 * Achievements API Routes
 */
import { Elysia } from "elysia";
import { prisma } from "../config/database";

// 初期実績データ
const ACHIEVEMENTS = [
  {
    key: "first_task",
    name: "はじめの一歩",
    description: "最初のタスクを完了",
    icon: "Star",
    color: "#FFD700",
    category: "tasks",
    condition: { type: "tasks_completed", count: 1 },
    rarity: "common",
  },
  {
    key: "task_10",
    name: "やる気満々",
    description: "10個のタスクを完了",
    icon: "Zap",
    color: "#F59E0B",
    category: "tasks",
    condition: { type: "tasks_completed", count: 10 },
    rarity: "common",
  },
  {
    key: "task_50",
    name: "努力家",
    description: "50個のタスクを完了",
    icon: "Award",
    color: "#8B5CF6",
    category: "tasks",
    condition: { type: "tasks_completed", count: 50 },
    rarity: "rare",
  },
  {
    key: "task_100",
    name: "タスクマスター",
    description: "100個のタスクを完了",
    icon: "Crown",
    color: "#EC4899",
    category: "tasks",
    condition: { type: "tasks_completed", count: 100 },
    rarity: "epic",
  },
  {
    key: "streak_3",
    name: "継続は力なり",
    description: "3日連続で学習",
    icon: "Flame",
    color: "#F97316",
    category: "streak",
    condition: { type: "streak", days: 3 },
    rarity: "common",
  },
  {
    key: "streak_7",
    name: "一週間の壁突破",
    description: "7日連続で学習",
    icon: "Flame",
    color: "#EF4444",
    category: "streak",
    condition: { type: "streak", days: 7 },
    rarity: "rare",
  },
  {
    key: "streak_30",
    name: "鉄人",
    description: "30日連続で学習",
    icon: "Flame",
    color: "#DC2626",
    category: "streak",
    condition: { type: "streak", days: 30 },
    rarity: "legendary",
  },
  {
    key: "study_10h",
    name: "学習の第一歩",
    description: "累計10時間学習",
    icon: "Clock",
    color: "#3B82F6",
    category: "study",
    condition: { type: "study_hours", hours: 10 },
    rarity: "common",
  },
  {
    key: "study_50h",
    name: "勉強熱心",
    description: "累計50時間学習",
    icon: "Clock",
    color: "#2563EB",
    category: "study",
    condition: { type: "study_hours", hours: 50 },
    rarity: "rare",
  },
  {
    key: "study_100h",
    name: "学習の達人",
    description: "累計100時間学習",
    icon: "BookOpen",
    color: "#1D4ED8",
    category: "study",
    condition: { type: "study_hours", hours: 100 },
    rarity: "epic",
  },
  {
    key: "exam_pass",
    name: "合格おめでとう",
    description: "試験目標を達成",
    icon: "Trophy",
    color: "#10B981",
    category: "exam",
    condition: { type: "exam_completed", count: 1 },
    rarity: "rare",
  },
  {
    key: "early_bird",
    name: "早起き学習",
    description: "朝6時前に学習開始",
    icon: "Sun",
    color: "#FBBF24",
    category: "special",
    condition: { type: "early_study" },
    rarity: "rare",
  },
  {
    key: "night_owl",
    name: "夜型学習者",
    description: "深夜0時以降に学習",
    icon: "Moon",
    color: "#6366F1",
    category: "special",
    condition: { type: "night_study" },
    rarity: "rare",
  },
  {
    key: "flashcard_master",
    name: "暗記王",
    description: "100枚のフラッシュカードを復習",
    icon: "Brain",
    color: "#8B5CF6",
    category: "flashcard",
    condition: { type: "flashcard_reviews", count: 100 },
    rarity: "rare",
  },
];

export const achievementsRoutes = new Elysia({ prefix: "/achievements" })
  .get("/", async () => {
    // 実績マスタを取得または作成
    let achievements = await prisma.achievement.findMany({
      include: {
        unlockedBy: true,
      },
      orderBy: { id: "asc" },
    });

    // 初期データがなければ作成
    if (achievements.length === 0) {
      await prisma.achievement.createMany({
        data: ACHIEVEMENTS.map((a) => ({
          key: a.key,
          name: a.name,
          description: a.description,
          icon: a.icon,
          color: a.color,
          category: a.category,
          condition: JSON.stringify(a.condition),
          rarity: a.rarity,
        })),
      });
      achievements = await prisma.achievement.findMany({
        include: { unlockedBy: true },
        orderBy: { id: "asc" },
      });
    }

    return achievements.map((a: { unlockedBy: { unlockedAt: Date }[] }) => ({
      ...a,
      isUnlocked: a.unlockedBy.length > 0,
      unlockedAt: a.unlockedBy[0]?.unlockedAt || null,
    }));
  })

  .post("/:key/unlock", async ({  params  }: any) => {
    const { key } = params as any;
    const achievement = await prisma.achievement.findUnique({ where: { key } });
    if (!achievement) return { error: "Achievement not found" };

    const existing = await prisma.userAchievement.findUnique({
      where: { achievementId: achievement.id },
    });
    if (existing)
      return {
        ...achievement,
        isUnlocked: true,
        unlockedAt: existing.unlockedAt,
      };

    await prisma.userAchievement.create({
      data: { achievementId: achievement.id },
    });

    return { ...achievement, isUnlocked: true, unlockedAt: new Date() };
  })

  // 実績チェック（タスク完了時などに呼ばれる）
  .post("/check", async () => {
    const newlyUnlocked: any[] = [];

    // タスク完了数をチェック
    const completedTasks = await prisma.task.count({
      where: { status: "done", parentId: null },
    });

    // ストリークをチェック
    let currentStreak = 0;
    try {
      const streakRes = await fetch(`http://localhost:${process.env.PORT || "3001"}/study-streaks/current`);
      if (streakRes.ok) {
        const streakData = (await streakRes.json()) as { currentStreak: number };
        currentStreak = streakData.currentStreak || 0;
      }
    } catch (e) {
      console.debug("Failed to fetch streak data:", e);
    }

    // 学習時間をチェック (hours単位)
    const timeEntries = await prisma.timeEntry.findMany();
    const totalHours = timeEntries.reduce(
      (sum: number, e: { duration: number }) => sum + e.duration,
      0
    );

    // 試験達成をチェック
    const completedExams = await prisma.examGoal.count({
      where: { isCompleted: true },
    });

    // フラッシュカードレビュー数をチェック
    const flashcardReviews = await prisma.flashcard.aggregate({
      _sum: { reviewCount: true },
    });
    const totalReviews = flashcardReviews._sum.reviewCount || 0;

    // 現在時刻をチェック（早朝/深夜学習）
    const currentHour = new Date().getHours();
    const isEarlyMorning = currentHour < 6;
    const isLateNight = currentHour >= 0 && currentHour < 4;

    // 今日の学習があるかチェック
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
    const hasStudiedToday = !!todayStreak;

    const achievements = await prisma.achievement.findMany({
      include: { unlockedBy: true },
    });

    for (const achievement of achievements) {
      if (achievement.unlockedBy.length > 0) continue;

      const condition = JSON.parse(achievement.condition) as {
        type: string;
        count?: number;
        days?: number;
        hours?: number;
      };
      let shouldUnlock = false;

      switch (condition.type) {
        case "tasks_completed":
          shouldUnlock = completedTasks >= (condition.count || 0);
          break;
        case "streak":
          shouldUnlock = currentStreak >= (condition.days || 0);
          break;
        case "study_hours":
          shouldUnlock = totalHours >= (condition.hours || 0);
          break;
        case "exam_completed":
          shouldUnlock = completedExams >= (condition.count || 0);
          break;
        case "flashcard_reviews":
          shouldUnlock = totalReviews >= (condition.count || 0);
          break;
        case "early_study":
          shouldUnlock = isEarlyMorning && hasStudiedToday;
          break;
        case "night_study":
          shouldUnlock = isLateNight && hasStudiedToday;
          break;
      }

      if (shouldUnlock) {
        await prisma.userAchievement.create({
          data: { achievementId: achievement.id },
        });
        newlyUnlocked.push({
          ...achievement,
          isUnlocked: true,
          unlockedAt: new Date(),
        });
      }
    }

    return { newlyUnlocked };
  });
