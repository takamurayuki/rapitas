/**
 * Agent Execution Config API Routes
 * エージェント実行設定の保存・取得API
 */
import { Elysia, t } from "elysia";
import { prisma } from "../../config/database";

export const agentExecutionConfigRoutes = new Elysia({
  prefix: "/agent-execution-config",
})
  // エージェント実行設定の取得
  .get("/:taskId", async (context) => {
    const { params, set } = context;
    const taskId = parseInt((params as any).taskId);

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
    async (context: any) => {
      const { params, body, set } = context;
      const taskId = parseInt((params as any).taskId);

      // タスクの存在確認
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) {
        set.status = 404;
        return { error: "Task not found" };
      }

      // バリデーション
      if (body.branchStrategy && !["auto", "manual", "none"].includes(body.branchStrategy)) {
        set.status = 400;
        return { error: "Invalid branchStrategy. Must be: auto, manual, none" };
      }
      if (body.requireApproval && !["always", "major_only", "never"].includes(body.requireApproval)) {
        set.status = 400;
        return { error: "Invalid requireApproval. Must be: always, major_only, never" };
      }
      if (body.reviewScope && !["changes", "full", "none"].includes(body.reviewScope)) {
        set.status = 400;
        return { error: "Invalid reviewScope. Must be: changes, full, none" };
      }
      if (body.timeoutMs !== undefined && (body.timeoutMs < 30000 || body.timeoutMs > 3600000)) {
        set.status = 400;
        return { error: "timeoutMs must be between 30000 (30s) and 3600000 (1h)" };
      }
      if (body.maxConcurrentAgents !== undefined && (body.maxConcurrentAgents < 1 || body.maxConcurrentAgents > 10)) {
        set.status = 400;
        return { error: "maxConcurrentAgents must be between 1 and 10" };
      }
      if (body.maxRetries !== undefined && (body.maxRetries < 0 || body.maxRetries > 5)) {
        set.status = 400;
        return { error: "maxRetries must be between 0 and 5" };
      }

      // agentConfigIdの存在確認
      if (body.agentConfigId) {
        const agentConfig = await prisma.aIAgentConfig.findUnique({
          where: { id: body.agentConfigId },
        });
        if (!agentConfig) {
          set.status = 400;
          return { error: "Agent config not found" };
        }
      }

      const config = await prisma.agentExecutionConfig.upsert({
        where: { taskId },
        update: {
          ...(body.agentConfigId !== undefined && { agentConfigId: body.agentConfigId }),
          ...(body.workingDirectory !== undefined && { workingDirectory: body.workingDirectory }),
          ...(body.timeoutMs !== undefined && { timeoutMs: body.timeoutMs }),
          ...(body.maxRetries !== undefined && { maxRetries: body.maxRetries }),
          ...(body.branchStrategy !== undefined && { branchStrategy: body.branchStrategy }),
          ...(body.branchPrefix !== undefined && { branchPrefix: body.branchPrefix }),
          ...(body.autoCommit !== undefined && { autoCommit: body.autoCommit }),
          ...(body.autoCreatePR !== undefined && { autoCreatePR: body.autoCreatePR }),
          ...(body.requireApproval !== undefined && { requireApproval: body.requireApproval }),
          ...(body.autoExecuteOnAnalysis !== undefined && { autoExecuteOnAnalysis: body.autoExecuteOnAnalysis }),
          ...(body.parallelExecution !== undefined && { parallelExecution: body.parallelExecution }),
          ...(body.maxConcurrentAgents !== undefined && { maxConcurrentAgents: body.maxConcurrentAgents }),
          ...(body.useOptimizedPrompt !== undefined && { useOptimizedPrompt: body.useOptimizedPrompt }),
          ...(body.additionalInstructions !== undefined && { additionalInstructions: body.additionalInstructions }),
          ...(body.autoCodeReview !== undefined && { autoCodeReview: body.autoCodeReview }),
          ...(body.reviewScope !== undefined && { reviewScope: body.reviewScope }),
          ...(body.notifyOnStart !== undefined && { notifyOnStart: body.notifyOnStart }),
          ...(body.notifyOnComplete !== undefined && { notifyOnComplete: body.notifyOnComplete }),
          ...(body.notifyOnError !== undefined && { notifyOnError: body.notifyOnError }),
          ...(body.notifyOnQuestion !== undefined && { notifyOnQuestion: body.notifyOnQuestion }),
        },
        create: {
          taskId,
          agentConfigId: body.agentConfigId ?? null,
          workingDirectory: body.workingDirectory ?? null,
          timeoutMs: body.timeoutMs ?? 900000,
          maxRetries: body.maxRetries ?? 0,
          branchStrategy: body.branchStrategy ?? "auto",
          branchPrefix: body.branchPrefix ?? "feature/",
          autoCommit: body.autoCommit ?? false,
          autoCreatePR: body.autoCreatePR ?? false,
          requireApproval: body.requireApproval ?? "always",
          autoExecuteOnAnalysis: body.autoExecuteOnAnalysis ?? false,
          parallelExecution: body.parallelExecution ?? false,
          maxConcurrentAgents: body.maxConcurrentAgents ?? 3,
          useOptimizedPrompt: body.useOptimizedPrompt ?? true,
          additionalInstructions: body.additionalInstructions ?? null,
          autoCodeReview: body.autoCodeReview ?? true,
          reviewScope: body.reviewScope ?? "changes",
          notifyOnStart: body.notifyOnStart ?? true,
          notifyOnComplete: body.notifyOnComplete ?? true,
          notifyOnError: body.notifyOnError ?? true,
          notifyOnQuestion: body.notifyOnQuestion ?? true,
        },
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

      return config;
    }
  )

  // エージェント実行設定の部分更新
  .patch(
    "/:taskId",
    async (context: any) => {
      const { params, body, set } = context;
      const taskId = parseInt((params as any).taskId);

      const existing = await prisma.agentExecutionConfig.findUnique({
        where: { taskId },
      });

      if (!existing) {
        set.status = 404;
        return { error: "Agent execution config not found. Use PUT to create." };
      }

      // バリデーション
      if (body.branchStrategy && !["auto", "manual", "none"].includes(body.branchStrategy)) {
        set.status = 400;
        return { error: "Invalid branchStrategy. Must be: auto, manual, none" };
      }
      if (body.requireApproval && !["always", "major_only", "never"].includes(body.requireApproval)) {
        set.status = 400;
        return { error: "Invalid requireApproval. Must be: always, major_only, never" };
      }
      if (body.reviewScope && !["changes", "full", "none"].includes(body.reviewScope)) {
        set.status = 400;
        return { error: "Invalid reviewScope. Must be: changes, full, none" };
      }
      if (body.timeoutMs !== undefined && (body.timeoutMs < 30000 || body.timeoutMs > 3600000)) {
        set.status = 400;
        return { error: "timeoutMs must be between 30000 (30s) and 3600000 (1h)" };
      }

      const config = await prisma.agentExecutionConfig.update({
        where: { taskId },
        data: {
          ...(body.agentConfigId !== undefined && { agentConfigId: body.agentConfigId }),
          ...(body.workingDirectory !== undefined && { workingDirectory: body.workingDirectory }),
          ...(body.timeoutMs !== undefined && { timeoutMs: body.timeoutMs }),
          ...(body.maxRetries !== undefined && { maxRetries: body.maxRetries }),
          ...(body.branchStrategy !== undefined && { branchStrategy: body.branchStrategy }),
          ...(body.branchPrefix !== undefined && { branchPrefix: body.branchPrefix }),
          ...(body.autoCommit !== undefined && { autoCommit: body.autoCommit }),
          ...(body.autoCreatePR !== undefined && { autoCreatePR: body.autoCreatePR }),
          ...(body.requireApproval !== undefined && { requireApproval: body.requireApproval }),
          ...(body.autoExecuteOnAnalysis !== undefined && { autoExecuteOnAnalysis: body.autoExecuteOnAnalysis }),
          ...(body.parallelExecution !== undefined && { parallelExecution: body.parallelExecution }),
          ...(body.maxConcurrentAgents !== undefined && { maxConcurrentAgents: body.maxConcurrentAgents }),
          ...(body.useOptimizedPrompt !== undefined && { useOptimizedPrompt: body.useOptimizedPrompt }),
          ...(body.additionalInstructions !== undefined && { additionalInstructions: body.additionalInstructions }),
          ...(body.autoCodeReview !== undefined && { autoCodeReview: body.autoCodeReview }),
          ...(body.reviewScope !== undefined && { reviewScope: body.reviewScope }),
          ...(body.notifyOnStart !== undefined && { notifyOnStart: body.notifyOnStart }),
          ...(body.notifyOnComplete !== undefined && { notifyOnComplete: body.notifyOnComplete }),
          ...(body.notifyOnError !== undefined && { notifyOnError: body.notifyOnError }),
          ...(body.notifyOnQuestion !== undefined && { notifyOnQuestion: body.notifyOnQuestion }),
        },
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

      return config;
    }
  )

  // エージェント実行設定の削除（デフォルトに戻す）
  .delete("/:taskId", async (context: any) => {
      const { params, set  } = context;
    const taskId = parseInt((params as any).taskId);

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
