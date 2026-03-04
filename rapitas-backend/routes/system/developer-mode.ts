/**
 * Developer Mode API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../../config/database";
import {
  analyzeTask,
  generateOptimizedPrompt,
  formatPromptForAgent,
  generateBranchName,
  generateTaskTitle,
  type TaskAnalysisResult,
} from "../../services/claude-agent";
import { getDefaultProvider, getApiKeyForProvider } from "../../utils/ai-client";
import { getLabelsArray, toJsonString, fromJsonString } from "../../utils/db-helpers";

export const developerModeRoutes = new Elysia({ prefix: "/developer-mode" })
  // 開発者モード設定取得
  .get("/config/:taskId", async (context: any) => {
      const { params  } = context;
    const taskId = parseInt(params.taskId);
    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId },
      include: {
        agentSessions: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
        approvalRequests: {
          where: { status: "pending" },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    return config;
  })

  // 開発者モード有効化
  .post(
    "/enable/:taskId",
    async (context) => {
      const { params, body } = context;
      const taskId = parseInt(params.taskId);
      const { autoApprove, maxSubtasks, priority  } = body as any;

      // タスクを更新
      await prisma.task.update({
        where: { id: taskId },
        data: { isDeveloperMode: true },
      });

      // 設定を作成または更新
      const config = await prisma.developerModeConfig.upsert({
        where: { taskId },
        update: {
          isEnabled: true,
          ...(autoApprove !== undefined && { autoApprove }),
          ...(maxSubtasks !== undefined && { maxSubtasks }),
          ...(priority !== undefined && { priority }),
        },
        create: {
          taskId,
          isEnabled: true,
          autoApprove: autoApprove ?? false,
          maxSubtasks: maxSubtasks ?? 10,
          priority: priority ?? "balanced",
        },
      });

      return config;
    }
  )

  // 開発者モード無効化
  .delete("/disable/:taskId", async (context: any) => {
      const { params  } = context;
    const taskId = parseInt(params.taskId);

    await prisma.task.update({
      where: { id: taskId },
      data: { isDeveloperMode: false },
    });

    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId },
    });

    if (config) {
      await prisma.developerModeConfig.update({
        where: { taskId },
        data: { isEnabled: false },
      });
    }

    return { success: true };
  })

  // 開発者モード設定更新
  .patch(
    "/config/:taskId",
    async (context: any) => {
      const { params, body } = context;
      const taskId = parseInt(params.taskId);
      const { autoApprove, notifyInApp, maxSubtasks, priority  } = body as any;

      return await prisma.developerModeConfig.update({
        where: { taskId },
        data: {
          ...(autoApprove !== undefined && { autoApprove }),
          ...(notifyInApp !== undefined && { notifyInApp }),
          ...(maxSubtasks !== undefined && { maxSubtasks }),
          ...(priority !== undefined && { priority }),
        },
      });
    }
  )

  // タスク分析・サブタスク提案
  .post(
    "/analyze/:taskId",
    async (context: any) => {
      const { params, set  } = context;
      const taskId = parseInt(params.taskId);

      // デフォルトプロバイダーのAPIキーチェック
      const defaultProvider = await getDefaultProvider();
      const apiKey = await getApiKeyForProvider(defaultProvider);
      if (!apiKey) {
        set.status = 400;
        return {
          error:
            "AIのAPIキーが設定されていません。設定ページでAPIキーを登録してください。",
        };
      }

      // タスクと設定を取得
      const task = await prisma.task.findUnique({
        where: { id: taskId },
      });

      if (!task) {
        set.status = 404;
        return { error: "タスクが見つかりません" };
      }

      const config = await prisma.developerModeConfig.findUnique({
        where: { taskId },
      });

      if (!config || !config.isEnabled) {
        set.status = 400;
        return {
          error:
            "このタスクでは開発者モードが有効になっていません。先に開発者モードを有効にしてください。",
        };
      }

      // セッションを作成
      const session = await prisma.agentSession.create({
        data: {
          configId: config.id,
          status: "running",
          startedAt: new Date(),
        },
      });

      try {
        // タスクを分析（デフォルトプロバイダーを使用）
        const { result, tokensUsed } = await analyzeTask(
          {
            id: task.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            dueDate: task.dueDate,
            estimatedHours: task.estimatedHours,
          },
          {
            maxSubtasks: config.maxSubtasks,
            priority: config.priority as "aggressive" | "balanced" | "conservative",
            provider: defaultProvider,
          }
        );

        // アクションを記録
        await prisma.agentAction.create({
          data: {
            sessionId: session.id,
            actionType: "analysis",
            targetTaskId: taskId,
            input: toJsonString({ taskTitle: task.title }),
            output: toJsonString(result),
            tokensUsed,
            status: "success",
          },
        });

        // セッションを更新
        await prisma.agentSession.update({
          where: { id: session.id },
          data: {
            totalTokensUsed: tokensUsed,
            lastActivityAt: new Date(),
          },
        });

        // 自動承認の場合は承認リクエストを作成せず、直接サブタスクを作成
        if (config.autoApprove) {
          // トランザクションで重複チェックと作成を原子的に実行
          const createdSubtasks = await prisma.$transaction(async (tx: typeof prisma) => {
            // トランザクション内で既存サブタスクを取得
            const existingSubtasks = await tx.task.findMany({
              where: { parentId: taskId },
              select: { title: true },
            });
            const existingTitles = new Set(existingSubtasks.map((st: { title: string }) => st.title.toLowerCase().trim()));

            const created = [];
            for (const subtask of result.suggestedSubtasks) {
              // タイトルが重複する場合はスキップ
              const normalizedTitle = subtask.title.toLowerCase().trim();
              if (existingTitles.has(normalizedTitle)) {
                console.log(`[developer-mode] Skipping duplicate subtask: ${subtask.title}`);
                continue;
              }
              existingTitles.add(normalizedTitle);

              const newSubtask = await tx.task.create({
                data: {
                  title: subtask.title,
                  description: subtask.description,
                  priority: subtask.priority,
                  estimatedHours: subtask.estimatedHours,
                  parentId: taskId,
                  agentGenerated: true,
                },
              });
              created.push(newSubtask);
            }
            return created;
          }, {
            isolationLevel: 'Serializable', // 競合を防ぐための分離レベル
          });

          await prisma.agentSession.update({
            where: { id: session.id },
            data: { status: "completed", completedAt: new Date() },
          });

          return {
            sessionId: session.id,
            analysis: result,
            autoApproved: true,
            createdSubtasks,
          };
        }

        // 承認リクエストを作成
        const approvalRequest = await prisma.approvalRequest.create({
          data: {
            configId: config.id,
            requestType: "subtask_creation",
            title: `「${task.title}」のサブタスク提案`,
            description: result.summary,
            proposedChanges: toJsonString({
              subtasks: result.suggestedSubtasks,
              reasoning: result.reasoning,
              tips: result.tips,
              complexity: result.complexity,
              estimatedTotalHours: result.estimatedTotalHours,
            }),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7日後
          },
        });

        // 通知を作成
        if (config.notifyInApp) {
          await prisma.notification.create({
            data: {
              type: "approval_request",
              title: "サブタスク提案",
              message: `「${task.title}」に${result.suggestedSubtasks.length}個のサブタスクが提案されました`,
              link: `/tasks/${taskId}`,
              metadata: toJsonString({ approvalRequestId: approvalRequest.id }),
            },
          });
        }

        return {
          sessionId: session.id,
          analysis: result,
          approvalRequestId: approvalRequest.id,
          autoApproved: false,
        };
      } catch (error: unknown) {
        // エラー時はセッションを失敗に更新
        await prisma.agentSession.update({
          where: { id: session.id },
          data: {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date(),
          },
        });

        set.status = 500;
        return {
          error: "Analysis failed",
          details: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  )

  // プロンプト最適化API
  .post(
    "/optimize-prompt/:taskId",
    async (context: any) => {
      const { params, body, set } = context;
      const taskId = parseInt(params.taskId);
      const { clarificationAnswers, savePrompt } = body || {};

      // デフォルトプロバイダーのAPIキーチェック
      const optimizeProvider = await getDefaultProvider();
      const optimizeApiKey = await getApiKeyForProvider(optimizeProvider);
      if (!optimizeApiKey) {
        set.status = 400;
        return {
          error:
            "AIのAPIキーが設定されていません。設定ページでAPIキーを登録してください。",
        };
      }

      // タスクとサブタスクを取得
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          subtasks: true,
        },
      });

      if (!task) {
        set.status = 404;
        return { error: "タスクが見つかりません" };
      }

      // 最新のAI分析結果を取得（存在する場合）
      const config = await prisma.developerModeConfig.findUnique({
        where: { taskId },
        include: {
          agentSessions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              agentActions: {
                where: { actionType: "analysis", status: "success" },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
      });

      let analysisResult = null;
      if (config?.agentSessions?.[0]?.agentActions?.[0]?.output) {
        analysisResult = fromJsonString(config.agentSessions[0].agentActions[0].output);
      }

      try {
        // プロンプト最適化を実行（デフォルトプロバイダーを使用）
        const { result, tokensUsed } = await generateOptimizedPrompt(
          {
            title: task.title,
            description: task.description,
            priority: task.priority,
            labels: getLabelsArray(task.labels),
          },
          analysisResult as TaskAnalysisResult | null,
          clarificationAnswers,
          optimizeProvider,
        );

        // トークン使用量を記録（セッションが存在する場合）
        if (config?.agentSessions?.[0]) {
          await prisma.agentSession.update({
            where: { id: config.agentSessions[0].id },
            data: {
              totalTokensUsed: {
                increment: tokensUsed,
              },
              lastActivityAt: new Date(),
            },
          });
        }

        // 質問がなく、保存オプションが有効な場合はプロンプトを保存
        let savedPromptId = null;
        if (
          savePrompt &&
          (!result.clarificationQuestions || result.clarificationQuestions.length === 0)
        ) {
          const savedPrompt = await prisma.taskPrompt.create({
            data: {
              taskId,
              name: `${task.title} - 最適化プロンプト`,
              originalDescription: task.description,
              optimizedPrompt: result.optimizedPrompt,
              structuredSections: toJsonString(result.structuredSections),
              qualityScore: result.promptQuality.score,
              isActive: true,
            },
          });
          savedPromptId = savedPrompt.id;
        }

        const questionsCount = result.clarificationQuestions?.length || 0;
        const hasQuestions = questionsCount > 0;

        return {
          optimizedPrompt: result.optimizedPrompt,
          structuredSections: result.structuredSections,
          clarificationQuestions: result.clarificationQuestions || [],
          promptQuality: result.promptQuality,
          tokensUsed,
          hasQuestions,
          savedPromptId,
          taskInfo: {
            id: task.id,
            title: task.title,
            hasSubtasks: task.subtasks.length > 0,
            subtaskCount: task.subtasks.length,
          },
        };
      } catch (error: unknown) {
        console.error("Prompt optimization error:", error);
        set.status = 500;
        return {
          error: "プロンプト最適化に失敗しました",
          details: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  )

  // 最適化プロンプトをエージェント実行用フォーマットに変換
  .post(
    "/format-prompt/:taskId",
    async (context: any) => {
      const { params, body, set } = context;
      const taskId = parseInt(params.taskId);
      const { optimizedResult  } = body as any;

      if (!optimizedResult) {
        set.status = 400;
        return { error: "optimizedResult is required" };
      }

      // タスクを取得
      const task = await prisma.task.findUnique({
        where: { id: taskId },
      });

      if (!task) {
        set.status = 404;
        return { error: "タスクが見つかりません" };
      }

      const formattedPrompt = formatPromptForAgent(optimizedResult, task.title);

      return {
        formattedPrompt,
      };
    },
    {
      body: t.Object({
        optimizedResult: t.Object({
          optimizedPrompt: t.String(),
          structuredSections: t.Object({
            objective: t.String(),
            context: t.String(),
            requirements: t.Array(t.String()),
            constraints: t.Array(t.String()),
            deliverables: t.Array(t.String()),
            technicalDetails: t.Optional(t.String()),
          }),
          promptQuality: t.Object({
            score: t.Number(),
            issues: t.Array(t.String()),
            suggestions: t.Array(t.String()),
          }),
        }),
      }),
    }
  )

  // ブランチ名生成API
  .post(
    "/generate-branch-name",
    async (context: any) => {
      const { body, set } = context;
      const { title, description } = body || {};

      if (!title) {
        set.status = 400;
        return { error: "タスクタイトルは必須です" };
      }

      // デフォルトプロバイダーのAPIキーチェック
      const branchProvider = await getDefaultProvider();
      const branchApiKey = await getApiKeyForProvider(branchProvider);
      if (!branchApiKey) {
        set.status = 400;
        return {
          error:
            "AIのAPIキーが設定されていません。設定ページでAPIキーを登録してください。",
        };
      }

      try {
        const result = await generateBranchName(title, description, branchProvider);
        return result;
      } catch (error: unknown) {
        console.error("Branch name generation error:", error);
        set.status = 500;
        return {
          error: "ブランチ名の生成に失敗しました",
          details: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      body: t.Object({
        title: t.String(),
        description: t.Optional(t.String()),
      }),
    }
  )

  // セッション履歴取得
  .get("/sessions/:taskId", async (context: any) => {
      const { params  } = context;
    const taskId = parseInt(params.taskId);

    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId },
    });

    if (!config) {
      return [];
    }

    return await prisma.agentSession.findMany({
      where: { configId: config.id },
      include: {
        agentActions: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  })

  // タスク説明からタイトル自動生成
  .post(
    "/generate-title",
    async (context: any) => {
      const { body, set } = context;
      const { description  } = body as any;

      if (!description || !description.trim()) {
        set.status = 400;
        return { error: "説明文は必須です" };
      }

      // デフォルトプロバイダーのAPIキーチェック
      const titleProvider = await getDefaultProvider();
      const titleApiKey = await getApiKeyForProvider(titleProvider);
      if (!titleApiKey) {
        set.status = 400;
        return {
          error:
            "AIのAPIキーが設定されていません。設定ページでAPIキーを登録してください。",
        };
      }

      try {
        const result = await generateTaskTitle(description, titleProvider);
        return result;
      } catch (error: unknown) {
        console.error("Title generation error:", error);
        set.status = 500;
        return {
          error: "タイトルの生成に失敗しました",
          details: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      body: t.Object({
        description: t.String(),
      }),
    }
  );
