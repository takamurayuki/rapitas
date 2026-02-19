/**
 * Task Analysis Config API Routes
 * タスク分析設定の保存・取得API
 */
import { Elysia } from "elysia";
import { prisma } from "../config/database";

export const taskAnalysisConfigRoutes = new Elysia({
  prefix: "/task-analysis-config",
})
  // タスク分析設定の取得
  .get("/:taskId", async ({  params, set  }: any) => {
    const taskId = parseInt(params.taskId);

    const existing = await prisma.taskAnalysisConfig.findUnique({
      where: { taskId },
    });

    if (!existing) {
      set.status = 404;
      return { error: "Task analysis config not found" };
    }

    await prisma.taskAnalysisConfig.delete({
      where: { taskId },
    });

    return { success: true, message: "Task analysis config deleted" };
  })

  // デフォルト設定値の取得
  .get("/defaults/values", async () => {
    return {
      analysisDepth: "standard",
      maxSubtasks: 10,
      priorityStrategy: "balanced",
      includeEstimates: true,
      includeDependencies: true,
      includeTips: true,
      promptStrategy: "auto",
      autoApproveSubtasks: false,
      autoOptimizePrompt: false,
      notifyOnComplete: true,
    };
  });
