/**
 * AI Agent API Routes
 * Agent configuration, task execution, and session management
 */
import { Elysia } from "elysia";
import { join } from "path";
import { prisma } from "../config/database";
import { agentFactory } from "../services/agents/agent-factory";
import { orchestrator } from "./approvals";
import { toJsonString, fromJsonString } from "../utils/db-helpers";
import { ParallelExecutor } from "../services/parallel-execution/parallel-executor";
import {
  encrypt,
  decrypt,
  maskApiKey,
  isEncryptionKeyConfigured,
} from "../utils/encryption";
import {
  getAgentConfigSchema,
  getAllAgentConfigSchemas,
  validateApiKeyFormat,
  validateAgentConfig,
} from "../utils/agent-config-schema";
import {
  logAgentConfigChange,
  calculateChanges,
  getAgentConfigAuditLogs,
  getRecentAuditLogs,
} from "../utils/agent-audit-log";
import {
  captureScreenshotsForDiff,
  type ScreenshotResult,
} from "../services/screenshot-service";
import { realtimeService } from "../services/realtime-service";
import { getModelsForAgentType, getAllModels } from "../utils/agent-models";

/**
 * スクリーンショット結果からフロントエンド表示に不要な path（ファイルシステムパス）を除外する
 */
function sanitizeScreenshots(screenshots: ScreenshotResult[]) {
  return screenshots.map(({ path, ...rest }) => rest);
}

/**
 * AgentExecution に question/questionType/questionDetails/claudeSessionId が
 * DB 上は存在するが Prisma の型定義に含まれないケースを安全にキャストするための型
 */
type ExecutionWithExtras = {
  question?: string | null;
  questionType?: string | null;
  questionDetails?: string | null;
  claudeSessionId?: string | null;
};

/**
 * エージェント出力からクリーンな実装サマリーを抽出する。
 * ログ出力やデバッグ情報、重複する説明を除去し、ユーザーが分かりやすい簡潔な説明にまとめる。
 */
function cleanImplementationSummary(rawOutput: string): string {
  if (!rawOutput || rawOutput.trim().length === 0) {
    return "実装が完了しました。";
  }

  const lines = rawOutput.split("\n");
  const cleanedLines: string[] = [];
  const seenContent = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();

    // 空行はスキップ（後で必要に応じて追加）
    if (trimmed === "") continue;

    // ログ出力パターンを除外
    if (/^\[(?:実行開始|実行中|API|DEBUG|INFO|WARN|ERROR|LOG)\]/.test(trimmed))
      continue;
    if (/^\[[\d\-T:.Z]+\]/.test(trimmed)) continue; // タイムスタンプ付きログ
    if (/^(?:>|>>|\$)\s/.test(trimmed)) continue; // コマンド実行行
    if (/^(?:npm|bun|yarn|pnpm)\s(?:run|install|build|test|exec)/.test(trimmed))
      continue;
    if (
      /^(?:Running|Executing|Starting|Compiling|Building|Installing)[\s:]/.test(
        trimmed,
      )
    )
      continue;
    if (/^(?:stdout|stderr|exit code|pid|process)[\s:]/i.test(trimmed))
      continue;
    if (/^(?:✓|✗|✔|✘|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏)\s/.test(trimmed)) continue; // スピナー・チェックマーク
    if (/^(?:warning|error|info|debug|trace|verbose)\s*:/i.test(trimmed))
      continue;
    if (
      /^(?:at\s+|Error:|TypeError:|ReferenceError:|SyntaxError:)/.test(trimmed)
    )
      continue; // スタックトレース
    if (/^(?:\d+\s+(?:passing|failing|pending))/.test(trimmed)) continue; // テスト結果の詳細行
    if (/console\.(?:log|error|warn|info|debug)\s*\(/.test(trimmed)) continue; // console.log呼び出し
    if (/^[\-=]{3,}$/.test(trimmed)) continue; // 区切り線
    if (/^#{4,}\s/.test(trimmed)) continue; // 深すぎる見出し（h4以下）は除外

    // 重複コンテンツを除去（正規化して比較）
    const normalized = trimmed.replace(/\s+/g, " ").toLowerCase();
    if (seenContent.has(normalized)) continue;
    seenContent.add(normalized);

    cleanedLines.push(line);
  }

  let result = cleanedLines.join("\n").trim();

  // 結果が空なら元のテキストの先頭部分を使用
  if (result.length === 0) {
    result = rawOutput.trim().substring(0, 500);
  }

  // 長すぎる場合は切り詰める（マークダウンの構造を壊さないように段落単位で）
  if (result.length > 2000) {
    const paragraphs = result.split(/\n\n+/);
    let truncated = "";
    for (const paragraph of paragraphs) {
      if (truncated.length + paragraph.length > 1800) break;
      truncated += (truncated ? "\n\n" : "") + paragraph;
    }
    result = truncated || result.substring(0, 1800);
  }

  return result;
}

// Parallel executor instance
let parallelExecutor: ParallelExecutor | null = null;
function getParallelExecutor(): ParallelExecutor {
  if (!parallelExecutor) {
    parallelExecutor = new ParallelExecutor(prisma);
  }
  return parallelExecutor;
}

// Upload directory for attachments
const UPLOAD_DIR = join(process.cwd(), "uploads");

export const aiAgentRoutes = new Elysia()
  // Agent configuration list (active only)
  .get("/agents", async () => {
    const agents = await prisma.aIAgentConfig.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { executions: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // 開発用とレビュー用のエージェントのみを返す
    const filteredAgents = agents.filter((agent: typeof agents[0]) => {
      // 開発用エージェント設定を確認
      const isDevelopmentAgent = agent.name.includes("Development Agent");
      // レビュー用エージェント設定を確認
      const isReviewAgent = agent.name.includes("Review Agent");
      // デフォルトエージェント
      const isDefaultAgent = agent.isDefault;

      return isDevelopmentAgent || isReviewAgent || isDefaultAgent;
    });

    return filteredAgents.map((agent: typeof filteredAgents[0]) => ({
      ...agent,
      capabilities: fromJsonString(agent.capabilities) ?? {},
    }));
  })

  // Agent configuration list (all, including inactive - for management page)
  .get("/agents/all", async () => {
    const agents = await prisma.aIAgentConfig.findMany({
      include: {
        _count: { select: { executions: true } },
      },
      orderBy: [
        { isDefault: "desc" },
        { isActive: "desc" },
        { createdAt: "desc" },
      ],
    });
    return agents.map((agent: typeof agents[0]) => ({
      ...agent,
      capabilities: fromJsonString(agent.capabilities) ?? {},
    }));
  })

  // Toggle agent active status
  .put(
    "/agents/:id/toggle-active",
    async ({  params  }: any) => {
      const agentId = parseInt(params.id, 10);
      if (isNaN(agentId)) {
        return { error: "Invalid agent ID" };
      }

      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: agentId },
      });
      if (!agent) {
        return { error: "Agent not found" };
      }

      // デフォルトエージェントは無効化できない
      if (agent.isDefault && agent.isActive) {
        return {
          error:
            "デフォルトエージェントは無効化できません。先に別のエージェントをデフォルトに設定してください。",
        };
      }

      const updated = await prisma.aIAgentConfig.update({
        where: { id: agentId },
        data: { isActive: !agent.isActive },
      });

      await logAgentConfigChange({
        agentConfigId: agentId,
        action: "update",
        changeDetails: {
          isActive: { from: agent.isActive, to: updated.isActive },
        },
        previousValues: { isActive: agent.isActive },
        newValues: { isActive: updated.isActive },
      });

      return updated;
    },
  )

  // Get default agent configuration
  .get("/agents/default", async () => {
    const defaultAgent = await prisma.aIAgentConfig.findFirst({
      where: { isDefault: true, isActive: true },
    });
    if (!defaultAgent) {
      // DBにデフォルトエージェントが設定されていない場合、組み込みのClaude Codeをフォールバックとして返す
      return {
        id: null,
        agentType: "claude-code",
        name: "Claude Code Agent",
        modelId: null,
        isDefault: true,
        isActive: true,
        isBuiltinFallback: true,
      };
    }
    return {
      ...defaultAgent,
      capabilities: fromJsonString(defaultAgent.capabilities) ?? {},
      isBuiltinFallback: false,
    };
  })

  // Set default agent by ID
  .put(
    "/agents/:id/set-default",
    async ({  params  }: any) => {
      const agentId = parseInt(params.id, 10);
      if (isNaN(agentId)) {
        return { error: "Invalid agent ID" };
      }

      // 対象エージェントが存在・アクティブか確認
      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: agentId },
      });
      if (!agent || !agent.isActive) {
        return { error: "Agent not found or inactive" };
      }

      // 既存のデフォルトを解除
      await prisma.aIAgentConfig.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });

      // 新しいデフォルトを設定
      const updated = await prisma.aIAgentConfig.update({
        where: { id: agentId },
        data: { isDefault: true },
      });

      // 監査ログを記録
      await logAgentConfigChange({
        agentConfigId: agentId,
        action: "update",
        previousValues: { isDefault: false },
        newValues: { isDefault: true },
      });

      console.log(
        `[agents] Default agent changed to: ${updated.name} (${updated.agentType})`,
      );
      return updated;
    },
  )

  // Clear default agent (revert to built-in Claude Code)
  .delete("/agents/default", async () => {
    await prisma.aIAgentConfig.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
    console.log(
      "[agents] Default agent cleared, reverting to built-in Claude Code",
    );
    return {
      success: true,
      message: "Default agent cleared. Will use built-in Claude Code.",
    };
  })

  // Create agent configuration
  .post(
    "/agents",
    async ({  body, set  }: any) => {
      const { taskId, instruction, sessionId, agentConfigId } = body as any;

      if (!taskId) {
        set.status = 400;
        return { error: "Task ID is required" };
      }

      if (!instruction?.trim()) {
        set.status = 400;
        return { error: "Instruction is required" };
      }

      try {
        // タスクと設定を取得
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          include: {
            developerModeConfig: true,
            theme: true,
          },
        });

        if (!task) {
          set.status = 404;
          return { error: "Task not found" };
        }

        // セッションIDが指定されていない場合は最新の完了済みセッションを取得
        let targetSessionId = sessionId;
        if (!targetSessionId && task.developerModeConfig) {
          const latestSession = await prisma.agentSession.findFirst({
            where: {
              configId: task.developerModeConfig.id,
              status: "completed",
            },
            orderBy: { createdAt: "desc" },
          });

          if (latestSession) {
            targetSessionId = latestSession.id;
          }
        }

        if (!targetSessionId) {
          set.status = 404;
          return { error: "No completed session found for this task" };
        }

        // セッション情報を取得
        const session = await prisma.agentSession.findUnique({
          where: { id: targetSessionId },
          include: {
            agentExecutions: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        });

        if (!session) {
          set.status = 404;
          return { error: "Session not found" };
        }

        if (session.status !== "completed") {
          set.status = 400;
          return { error: "Can only continue from completed sessions" };
        }

        // 前回の実行情報を取得
        const previousExecution = session.agentExecutions[0];
        const workingDirectory = task.theme?.workingDirectory || process.cwd();

        // セッションを再開状態に更新
        await prisma.agentSession.update({
          where: { id: targetSessionId },
          data: {
            status: "running",
            lastActivityAt: new Date(),
          },
        });

        // タスクのステータスを「進行中」に更新
        await prisma.task.update({
          where: { id: taskId },
          data: {
            status: "in-progress",
          },
        });

        console.log(
          `[continue-execution] Continuing execution for task ${taskId} in session ${targetSessionId}`,
        );

        // 通知を作成
        await prisma.notification.create({
          data: {
            type: "agent_execution_continued",
            title: "追加指示実行開始",
            message: `「${task.title}」に追加指示を実行しています`,
            link: `/tasks/${taskId}`,
            metadata: toJsonString({ sessionId: targetSessionId, taskId }),
          },
        });

        // 前回の実行ログを含めて新しい指示を作成
        let fullInstruction = `## 追加指示\n\n${instruction}`;

        // 前回の実行で生成したコードや変更内容を参考情報として含める
        if (previousExecution?.output) {
          const prevOutput = previousExecution.output.substring(0, 3000);
          fullInstruction = `## 前回の実行内容\n\n前回の実行で以下の作業を行いました：\n\n${prevOutput}${previousExecution.output.length > 3000 ? "\n...(省略)" : ""}\n\n${fullInstruction}`;
        }

        // オーケストレーターで実行（同じセッションで継続）
        orchestrator
          .executeTask(
            {
              id: taskId,
              title: task.title,
              description: fullInstruction,
              context: task.executionInstructions || undefined,
              workingDirectory,
            },
            {
              taskId,
              sessionId: targetSessionId,
              agentConfigId: agentConfigId || previousExecution?.agentConfigId,
              workingDirectory,
              continueFromPrevious: true, // 前回の実行からの継続であることを示すフラグ
            },
          )
          .then(async (result) => {
            if (result.success) {
              // タスクのステータスを「完了」に更新
              await prisma.task.update({
                where: { id: taskId },
                data: {
                  status: "done",
                  completedAt: new Date(),
                },
              });

              // セッションのステータスも完了に更新
              await prisma.agentSession.update({
                where: { id: targetSessionId },
                data: {
                  status: "completed",
                  completedAt: new Date(),
                },
              });

              // 差分を取得して承認リクエストを作成
              const diff = await orchestrator.getFullGitDiff(workingDirectory);
              const structuredDiff =
                await orchestrator.getDiff(workingDirectory);

              if (diff && diff !== "No changes detected") {
                const implementationSummary = cleanImplementationSummary(
                  result.output || "追加指示の実装が完了しました。",
                );

                // スクリーンショットを撮影
                let screenshots: ScreenshotResult[] = [];
                try {
                  screenshots = await captureScreenshotsForDiff(
                    structuredDiff,
                    {
                      workingDirectory,
                      agentOutput: result.output || "",
                    },
                  );
                } catch (screenshotErr) {
                  console.warn(
                    "[continue-execution] Screenshot capture failed:",
                    screenshotErr,
                  );
                }

                const approvalRequest = await prisma.approvalRequest.create({
                  data: {
                    configId: task.developerModeConfig!.id,
                    requestType: "code_review",
                    title: `「${task.title}」の追加変更レビュー`,
                    description: implementationSummary,
                    proposedChanges: toJsonString({
                      taskId,
                      sessionId: targetSessionId,
                      workingDirectory,
                      structuredDiff,
                      implementationSummary,
                      executionTimeMs: result.executionTimeMs,
                      screenshots: sanitizeScreenshots(screenshots),
                      isContinuation: true,
                    }),
                    executionType: "code_review",
                    estimatedChanges: toJsonString({
                      filesChanged: structuredDiff.length,
                      summary: implementationSummary.substring(0, 500),
                    }),
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                  },
                });

                await prisma.notification.create({
                  data: {
                    type: "pr_review_requested",
                    title: "追加変更のレビュー依頼",
                    message: `「${task.title}」の追加変更が完了しました。レビューをお願いします。`,
                    link: `/approvals/${approvalRequest.id}`,
                    metadata: toJsonString({
                      approvalRequestId: approvalRequest.id,
                      sessionId: targetSessionId,
                      taskId,
                    }),
                  },
                });
              }
            } else {
              // 失敗時はタスクを未着手に戻す
              await prisma.task.update({
                where: { id: taskId },
                data: { status: "todo" },
              });

              // セッションも失敗状態に
              await prisma.agentSession.update({
                where: { id: targetSessionId },
                data: {
                  status: "failed",
                  completedAt: new Date(),
                  errorMessage: result.errorMessage || "Continuation failed",
                },
              });

              await prisma.notification.create({
                data: {
                  type: "agent_error",
                  title: "追加指示実行失敗",
                  message: `「${task.title}」の追加指示実行が失敗しました: ${result.errorMessage}`,
                  link: `/tasks/${taskId}`,
                  metadata: toJsonString({
                    sessionId: targetSessionId,
                    taskId,
                  }),
                },
              });
            }
          })
          .catch(async (error) => {
            console.error("[continue-execution] Error:", error);

            // エラー時もタスクを未着手に戻す
            await prisma.task
              .update({
                where: { id: taskId },
                data: { status: "todo" },
              })
              .catch(() => {});

            // セッションも失敗状態に
            await prisma.agentSession
              .update({
                where: { id: targetSessionId },
                data: {
                  status: "failed",
                  completedAt: new Date(),
                  errorMessage: error.message || "Continuation error",
                },
              })
              .catch(() => {});

            await prisma.notification.create({
              data: {
                type: "agent_error",
                title: "追加指示実行エラー",
                message: `「${task.title}」の追加指示実行中にエラーが発生しました`,
                link: `/tasks/${taskId}`,
              },
            });
          });

        return {
          success: true,
          sessionId: targetSessionId,
          taskId,
          workingDirectory,
          message:
            "追加指示の実行を開始しました。リアルタイムで進捗を確認できます。",
        };
      } catch (error) {
        console.error("[continue-execution] Error:", error);
        set.status = 500;
        return {
          error:
            error instanceof Error
              ? error.message
              : "Failed to continue execution",
        };
      }
    },
  )

  // Server restart endpoint (called by frontend or dev tools)
  // Performs graceful shutdown then exits with code 75 to signal dev.js to restart
  .post("/agents/restart", async () => {
    try {
      console.log("[restart] Server restart requested via API");

      const activeCount = orchestrator.getActiveExecutionCount();

      // レスポンス送信後に即座にリスニングソケットを閉じ、その後エージェントを停止する
      setTimeout(async () => {
        try {
          // Step 1: SSE接続を全て閉じる（CLOSE_WAIT蓄積を防止）
          console.log("[restart] Closing all SSE connections...");
          realtimeService.shutdown();

          // Step 2: リスニングソケットを即座に閉じる（ポート解放を最優先）
          console.log(
            "[restart] Closing listening socket first for quick port release...",
          );
          await orchestrator.stopServer();
          console.log("[restart] Listening socket closed, port released.");

          // Step 3: エージェント停止とDB保存
          console.log("[restart] Stopping agents and saving state...");
          await orchestrator.gracefulShutdown({ skipServerStop: true });
          console.log("[restart] Agent shutdown completed.");
        } catch (error) {
          console.error("[restart] Graceful shutdown error:", error);
        } finally {
          // Step 4: 終了コード75でdev.jsに再起動を通知
          console.log("[restart] Exiting with restart code...");
          setTimeout(() => process.exit(75), 200);
        }
      }, 300); // レスポンス送信の時間を確保

      return {
        success: true,
        message:
          "Server restart initiated. Server will stop and restart automatically.",
        activeExecutions: activeCount,
      };
    } catch (error) {
      console.error("[restart] Error:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to initiate restart",
      };
    }
  });
