/**
 * Task Analysis Config API Routes
 * タスク分析設定の保存・取得API
 */
import { Elysia, t } from "elysia";
import { prisma } from "../../config/database";

export const taskAnalysisConfigRoutes = new Elysia({
  prefix: "/task-analysis-config",
})
  // タスク分析設定の取得
  .get("/:taskId", async (context: any) => {
      const { params, set  } = context;
    const taskId = parseInt(params.taskId);

    const config = await prisma.taskAnalysisConfig.findUnique({
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
      return { error: "Task analysis config not found" };
    }

    return config;
  })

  // タスク分析設定の作成または更新（upsert）
  .put(
    "/:taskId",
    async (context) => {
      const { params, body: rawBody, set } = context;
      const body = rawBody as any;
      const taskId = parseInt(params.taskId);

      // タスクの存在確認
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) {
        set.status = 404;
        return { error: "Task not found" };
      }

      // バリデーション
      if (body.analysisDepth && !["quick", "standard", "deep"].includes(body.analysisDepth)) {
        set.status = 400;
        return { error: "Invalid analysisDepth. Must be: quick, standard, deep" };
      }
      if (body.priorityStrategy && !["aggressive", "balanced", "conservative"].includes(body.priorityStrategy)) {
        set.status = 400;
        return { error: "Invalid priorityStrategy. Must be: aggressive, balanced, conservative" };
      }
      if (body.promptStrategy && !["auto", "detailed", "concise", "custom"].includes(body.promptStrategy)) {
        set.status = 400;
        return { error: "Invalid promptStrategy. Must be: auto, detailed, concise, custom" };
      }
      if (body.temperature !== undefined && body.temperature !== null && (body.temperature < 0 || body.temperature > 1)) {
        set.status = 400;
        return { error: "Temperature must be between 0.0 and 1.0" };
      }
      if (body.maxSubtasks !== undefined && (body.maxSubtasks < 1 || body.maxSubtasks > 50)) {
        set.status = 400;
        return { error: "maxSubtasks must be between 1 and 50" };
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

      const config = await prisma.taskAnalysisConfig.upsert({
        where: { taskId },
        update: {
          ...(body.analysisDepth !== undefined && { analysisDepth: body.analysisDepth }),
          ...(body.maxSubtasks !== undefined && { maxSubtasks: body.maxSubtasks }),
          ...(body.priorityStrategy !== undefined && { priorityStrategy: body.priorityStrategy }),
          ...(body.includeEstimates !== undefined && { includeEstimates: body.includeEstimates }),
          ...(body.includeDependencies !== undefined && { includeDependencies: body.includeDependencies }),
          ...(body.includeTips !== undefined && { includeTips: body.includeTips }),
          ...(body.agentConfigId !== undefined && { agentConfigId: body.agentConfigId }),
          ...(body.modelOverride !== undefined && { modelOverride: body.modelOverride }),
          ...(body.maxTokens !== undefined && { maxTokens: body.maxTokens }),
          ...(body.temperature !== undefined && { temperature: body.temperature }),
          ...(body.promptStrategy !== undefined && { promptStrategy: body.promptStrategy }),
          ...(body.customPromptTemplate !== undefined && { customPromptTemplate: body.customPromptTemplate }),
          ...(body.contextInstructions !== undefined && { contextInstructions: body.contextInstructions }),
          ...(body.autoApproveSubtasks !== undefined && { autoApproveSubtasks: body.autoApproveSubtasks }),
          ...(body.autoOptimizePrompt !== undefined && { autoOptimizePrompt: body.autoOptimizePrompt }),
          ...(body.notifyOnComplete !== undefined && { notifyOnComplete: body.notifyOnComplete }),
        },
        create: {
          taskId,
          analysisDepth: body.analysisDepth ?? "standard",
          maxSubtasks: body.maxSubtasks ?? 10,
          priorityStrategy: body.priorityStrategy ?? "balanced",
          includeEstimates: body.includeEstimates ?? true,
          includeDependencies: body.includeDependencies ?? true,
          includeTips: body.includeTips ?? true,
          agentConfigId: body.agentConfigId ?? null,
          modelOverride: body.modelOverride ?? null,
          maxTokens: body.maxTokens ?? null,
          temperature: body.temperature ?? null,
          promptStrategy: body.promptStrategy ?? "auto",
          customPromptTemplate: body.customPromptTemplate ?? null,
          contextInstructions: body.contextInstructions ?? null,
          autoApproveSubtasks: body.autoApproveSubtasks ?? false,
          autoOptimizePrompt: body.autoOptimizePrompt ?? false,
          notifyOnComplete: body.notifyOnComplete ?? true,
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

  // タスク分析設定の部分更新
  .patch(
    "/:taskId",
    async (context) => {
      const { params, body: rawBody, set } = context;
      const body = rawBody as any;
      const taskId = parseInt(params.taskId);

      const existing = await prisma.taskAnalysisConfig.findUnique({
        where: { taskId },
      });

      if (!existing) {
        set.status = 404;
        return { error: "Task analysis config not found. Use PUT to create." };
      }

      // バリデーション
      if (body.analysisDepth && !["quick", "standard", "deep"].includes(body.analysisDepth)) {
        set.status = 400;
        return { error: "Invalid analysisDepth. Must be: quick, standard, deep" };
      }
      if (body.priorityStrategy && !["aggressive", "balanced", "conservative"].includes(body.priorityStrategy)) {
        set.status = 400;
        return { error: "Invalid priorityStrategy. Must be: aggressive, balanced, conservative" };
      }
      if (body.promptStrategy && !["auto", "detailed", "concise", "custom"].includes(body.promptStrategy)) {
        set.status = 400;
        return { error: "Invalid promptStrategy. Must be: auto, detailed, concise, custom" };
      }
      if (body.temperature !== undefined && body.temperature !== null && (body.temperature < 0 || body.temperature > 1)) {
        set.status = 400;
        return { error: "Temperature must be between 0.0 and 1.0" };
      }

      const config = await prisma.taskAnalysisConfig.update({
        where: { taskId },
        data: {
          ...(body.analysisDepth !== undefined && { analysisDepth: body.analysisDepth }),
          ...(body.maxSubtasks !== undefined && { maxSubtasks: body.maxSubtasks }),
          ...(body.priorityStrategy !== undefined && { priorityStrategy: body.priorityStrategy }),
          ...(body.includeEstimates !== undefined && { includeEstimates: body.includeEstimates }),
          ...(body.includeDependencies !== undefined && { includeDependencies: body.includeDependencies }),
          ...(body.includeTips !== undefined && { includeTips: body.includeTips }),
          ...(body.agentConfigId !== undefined && { agentConfigId: body.agentConfigId }),
          ...(body.modelOverride !== undefined && { modelOverride: body.modelOverride }),
          ...(body.maxTokens !== undefined && { maxTokens: body.maxTokens }),
          ...(body.temperature !== undefined && { temperature: body.temperature }),
          ...(body.promptStrategy !== undefined && { promptStrategy: body.promptStrategy }),
          ...(body.customPromptTemplate !== undefined && { customPromptTemplate: body.customPromptTemplate }),
          ...(body.contextInstructions !== undefined && { contextInstructions: body.contextInstructions }),
          ...(body.autoApproveSubtasks !== undefined && { autoApproveSubtasks: body.autoApproveSubtasks }),
          ...(body.autoOptimizePrompt !== undefined && { autoOptimizePrompt: body.autoOptimizePrompt }),
          ...(body.notifyOnComplete !== undefined && { notifyOnComplete: body.notifyOnComplete }),
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

  // タスク分析設定の削除（デフォルトに戻す）
  .delete("/:taskId", async (context: any) => {
      const { params, set  } = context;
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
