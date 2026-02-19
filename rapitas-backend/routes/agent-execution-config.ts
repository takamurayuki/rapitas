/**
 * Agent Execution Config API Routes
 * エージェント実行設定の保存・取得API
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";

export const agentExecutionConfigRoutes = new Elysia({
  prefix: "/agent-execution-config",
})
  // エージェント実行設定の取得
  .get("/:taskId", async ({ params, set }: any) => {
    const taskId = parseInt(params.taskId);

    const config = await prisma.agentExecutionConfig.findUnique({
      where: { taskId },
      include: {
        agentConfig: {
          select: {
            id: true,
            agentType: true,
            name: true,
            modelId: true,
            isActive: true,
          },
        },
      },
    });

    if (!config) {
      set.status = 404;
      return { error: "Agent execution config not found" };
    }

    return config;
  })

  // エージェント実行設定の作成または更新（upsert）
  .put(
    "/:taskId",
    async ({  params, body, set  }: any) => {
    const taskId = parseInt(params.taskId);

    const existing = await prisma.agentExecutionConfig.findUnique({
      where: { taskId },
    });

    if (!existing) {
      set.status = 404;
      return { error: "Agent execution config not found" };
    }

    await prisma.agentExecutionConfig.delete({
      where: { taskId },
    });

    return { success: true, message: "Agent execution config deleted" };
  })

  // デフォルト設定値の取得
  .get("/defaults/values", async () => {
    return {
      timeoutMs: 900000,
      maxRetries: 0,
      branchStrategy: "auto",
      branchPrefix: "feature/",
      autoCommit: false,
      autoCreatePR: false,
      requireApproval: "always",
      autoExecuteOnAnalysis: false,
      parallelExecution: false,
      maxConcurrentAgents: 3,
      useOptimizedPrompt: true,
      autoCodeReview: true,
      reviewScope: "changes",
      notifyOnStart: true,
      notifyOnComplete: true,
      notifyOnError: true,
      notifyOnQuestion: true,
    };
  });
