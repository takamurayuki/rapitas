/**
 * Study Plan API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";

export const studyPlansRoutes = new Elysia({ prefix: "/study-plans" })
  .get("/", async () => {
    return await prisma.studyPlan.findMany({
      orderBy: { createdAt: "desc" },
    });
  })

  .get("/:id", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    return await prisma.studyPlan.findUnique({
      where: { id },
    });
  })

  .post(
    "/",
    async ({
      body,
    }: {
      body: {
        examGoalId?: number | null;
        subject: string;
        prompt: string;
        generatedPlan: unknown;
        totalDays: number;
        startDate: string;
        endDate: string;
      };
    }) => {
      const { examGoalId, subject, prompt, generatedPlan, totalDays, startDate, endDate } = body;
      return await prisma.studyPlan.create({
        data: {
          subject,
          prompt,
          generatedPlan,
          totalDays,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          ...(examGoalId && { examGoalId }),
        },
      });
    },
    {
      body: t.Object({
        examGoalId: t.Optional(t.Nullable(t.Number())),
        subject: t.String(),
        prompt: t.String(),
        generatedPlan: t.Any(),
        totalDays: t.Number(),
        startDate: t.String(),
        endDate: t.String(),
      }),
    }
  )

  .patch(
    "/:id",
    async ({ params, body }: { params: { id: string }; body: { isApplied?: boolean } }) => {
      const id = parseInt(params.id);
      const { isApplied } = body;
      return await prisma.studyPlan.update({
        where: { id },
        data: {
          ...(isApplied !== undefined && { isApplied }),
        },
      });
    }
  )

  // 学習プランをタスクに適用
  .post("/:id/apply", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    const studyPlan = await prisma.studyPlan.findUnique({
      where: { id },
    });
    if (!studyPlan) return { error: "Study plan not found" };

    const plan = studyPlan.generatedPlan as {
      phases: {
        name: string;
        days: number;
        tasks: string[];
        dailyHours: number;
      }[];
    };
    const createdTasks = [];
    let currentDate = new Date(studyPlan.startDate);

    // 各フェーズのタスクを作成
    for (const phase of plan.phases) {
      const phaseDays = phase.days;
      const phaseEndDate = new Date(currentDate);
      phaseEndDate.setDate(phaseEndDate.getDate() + phaseDays);

      for (const taskTitle of phase.tasks) {
        const task = await prisma.task.create({
          data: {
            title: `[${studyPlan.subject}] ${taskTitle}`,
            description: `学習計画「${studyPlan.subject}」のフェーズ「${phase.name}」のタスクです。\n\n目標: 1日${phase.dailyHours}時間`,
            status: "todo",
            subject: studyPlan.subject,
            estimatedHours: phase.dailyHours,
            dueDate: phaseEndDate,
            ...(studyPlan.examGoalId && { examGoalId: studyPlan.examGoalId }),
          },
        });
        createdTasks.push(task);
      }

      currentDate = phaseEndDate;
    }

    // 学習プランを適用済みに更新
    await prisma.studyPlan.update({
      where: { id },
      data: { isApplied: true },
    });

    return { createdTasks, count: createdTasks.length };
  })

  .delete("/:id", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    return await prisma.studyPlan.delete({
      where: { id },
    });
  })

  // AI学習計画生成（モックAPI - 実際のAI連携は後で追加）
  .post(
    "/generate",
    async ({
      body,
    }: {
      body: {
        subject: string | null;
        examDate: string | null;
        targetScore?: string | null;
        studyHoursPerDay: number | null;
        currentLevel: string | null;
      };
    }) => {
      const { subject, examDate, targetScore, studyHoursPerDay } = body;

      const start = new Date();
      const end = new Date(examDate || "");
      const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

      // AIによる計画生成をシミュレート（実際にはOpenAI APIを呼び出す）
      const phases = [];
      const phaseDays = Math.floor(totalDays / 3);

      phases.push({
        name: "基礎固め",
        days: phaseDays,
        tasks: [
          `${subject}の基本概念を学習`,
          `${subject}の用語を暗記`,
          "過去問を確認して傾向を把握",
        ],
        dailyHours: Number(studyHoursPerDay) * 0.8,
      });

      phases.push({
        name: "応用力強化",
        days: phaseDays,
        tasks: [
          `${subject}の応用問題に取り組む`,
          "弱点分野を重点的に学習",
          "模擬試験を解く",
        ],
        dailyHours: Number(studyHoursPerDay),
      });

      phases.push({
        name: "総仕上げ",
        days: totalDays - phaseDays * 2,
        tasks: [
          "過去問を時間を計って解く",
          "間違えた問題の復習",
          `${targetScore ? `目標${targetScore}達成のための最終調整` : "試験本番に向けた最終確認"}`,
        ],
        dailyHours: Number(studyHoursPerDay) * 1.2,
      });

      const generatedPlan = {
        subject,
        targetScore,
        totalDays,
        studyHoursPerDay,
        phases,
        tips: [
          "毎日同じ時間に学習する習慣をつけましょう",
          "休憩を適度に取り、集中力を維持しましょう",
          "復習は記憶定着に重要です",
        ],
      };

      return {
        generatedPlan,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        totalDays,
      };
    },
    {
      body: t.Object({
        subject: t.Nullable(t.String()),
        examDate: t.Nullable(t.String()),
        targetScore: t.Optional(t.Nullable(t.String())),
        studyHoursPerDay: t.Nullable(t.Number()),
        currentLevel: t.Nullable(t.String()),
      }),
    }
  );
