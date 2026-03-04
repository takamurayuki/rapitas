/**
 * Agent Execution Router
 * タスク実行機能（実行開始・停止・継続・ステータス確認・エージェント応答）
 */
import { Elysia, t } from "elysia";
import { join } from "path";
import { prisma } from "../../config/database";
import { createLogger } from "../../config/logger";
import { orchestrator } from "./approvals";
import { toJsonString, fromJsonString } from "../../utils/db-helpers";
import {
  cleanImplementationSummary,
  sanitizeScreenshots,
} from "../../utils/agent-response-cleaner";
import { captureScreenshotsForDiff } from "../../services/screenshot-service";
import { generateBranchName } from "../../utils/branch-name-generator";
import type { AgentExecutionWithExtras } from "../../types/agent-execution-types";
import type { ScreenshotResult } from "../../services/screenshot-service";
import { analyzeTaskComplexity } from "../../services/workflow/complexity-analyzer";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";
const log = createLogger("routes:agent-execution");

/**
 * セッションステータス更新のリトライ処理付きヘルパー関数
 * @param sessionId - セッションID
 * @param status - 更新後のステータス
 * @param logPrefix - ログのプレフィックス
 * @param maxRetries - 最大リトライ回数（デフォルト3回）
 */
async function updateSessionStatusWithRetry(
  sessionId: number,
  status: "completed" | "failed",
  logPrefix: string = "",
  maxRetries: number = 3
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.agentSession.update({
        where: { id: sessionId },
        data: {
          status,
          completedAt: new Date(),
          ...(status === "failed" && { errorMessage: "Execution failed" }),
        },
      });

      // 成功した場合
      if (attempt > 1) {
        log.info(
          `${logPrefix} Session ${sessionId} status updated to ${status} on attempt ${attempt}`
        );
      }
      return;
    } catch (error) {
      lastError = error;
      log.warn({ err: error },
        `${logPrefix} Failed to update session ${sessionId} status (attempt ${attempt}/${maxRetries})`,
      );

      // 最後の試行でない場合は少し待つ
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  // 全ての試行が失敗した場合
  log.error({ err: lastError },
    `${logPrefix} Failed to update session ${sessionId} status after ${maxRetries} attempts`,
  );
  // エラーを再投げせず、処理を継続（従来の動作と同様）
}

/**
 * 実行完了後のコードレビュー承認リクエスト作成（autoApprove対応）
 * 通常実行と継続実行の両方から呼び出される共通処理
 */
async function createCodeReviewApproval(params: {
  taskId: number;
  taskTitle: string;
  configId: number;
  sessionId: number;
  workDir: string;
  branchName?: string;
  resultOutput?: string;
  executionTimeMs?: number;
  logPrefix: string;
}): Promise<void> {
  const {
    taskId,
    taskTitle,
    configId,
    sessionId,
    workDir,
    branchName,
    resultOutput,
    executionTimeMs,
    logPrefix,
  } = params;

  try {
    const diff = await orchestrator.getFullGitDiff(workDir);
    const structuredDiff = await orchestrator.getDiff(workDir);

    if (diff && diff !== "No changes detected") {
      const implementationSummary = cleanImplementationSummary(
        resultOutput || "実装が完了しました。",
      );

      // UI変更がある場合はスクリーンショットを撮影
      let screenshots: ScreenshotResult[] = [];
      try {
        screenshots = await captureScreenshotsForDiff(structuredDiff, {
          workingDirectory: workDir,
          agentOutput: resultOutput || "",
        });
        if (screenshots.length > 0) {
          log.info(
            `${logPrefix} Captured ${screenshots.length} screenshots for task ${taskId}: ${screenshots.map((s) => s.page).join(", ")}`,
          );
        }
      } catch (screenshotErr) {
        log.warn({ err: screenshotErr }, `${logPrefix} Screenshot capture failed (non-fatal)`);
      }

      const screenshotData = sanitizeScreenshots(screenshots);

      // autoApprove設定を確認
      const devConfig = await prisma.developerModeConfig.findUnique({
        where: { id: configId },
        select: { autoApprove: true },
      });
      const isAutoApprove = devConfig?.autoApprove === true;

      try {
        const approvalRequest = await prisma.approvalRequest.create({
          data: {
            configId,
            requestType: "code_review",
            title: `「${taskTitle}」のコードレビュー`,
            description: implementationSummary,
            status: isAutoApprove ? "approved" : "pending",
            proposedChanges: toJsonString({
              taskId,
              sessionId,
              workingDirectory: workDir,
              branchName,
              structuredDiff,
              implementationSummary,
              executionTimeMs,
              screenshots: screenshotData,
            }),
            executionType: "code_review",
            estimatedChanges: toJsonString({
              filesChanged: structuredDiff.length,
              summary: implementationSummary.substring(0, 500),
            }),
            ...(isAutoApprove && { approvedAt: new Date() }),
          },
        });

        if (isAutoApprove) {
          log.info(
            `${logPrefix} Auto-approved code review for task ${taskId} (approval #${approvalRequest.id})`,
          );
        } else {
          log.info(
            `${logPrefix} Created code review approval #${approvalRequest.id} for task ${taskId}`,
          );
        }
      } catch (approvalError) {
        log.error({ err: approvalError }, `${logPrefix} Failed to create approval request for task ${taskId}`);
      }
    }
  } catch (diffError) {
    log.error({ err: diffError }, `${logPrefix} Failed to get diff for task ${taskId}`);
  }
}

export const agentExecutionRouter = new Elysia()
  // Execute agent on task
  .post(
    "/tasks/:id/execute",
    async (context) => {
      const params = context.params as { id: string };
      const body = context.body as {
        agentConfigId?: number;
        workingDirectory?: string;
        timeout?: number;
        instruction?: string;
        branchName?: string;
        useTaskAnalysis?: boolean;
        optimizedPrompt?: string;
        sessionId?: number;
        attachments?: Array<{
          id: number;
          title: string;
          type: string;
          fileName?: string;
          filePath?: string;
          mimeType?: string;
          description?: string;
        }>;
      };
      const { id } = params;
      const taskIdNum = parseInt(id);
      const {
        agentConfigId,
        workingDirectory,
        timeout,
        instruction,
        branchName,
        useTaskAnalysis,
        optimizedPrompt,
        sessionId,
        attachments,
      } = body;

      let task;
      try {
        task = await prisma.task.findUnique({
          where: { id: taskIdNum },
          include: {
            developerModeConfig: true,
            theme: true,
          },
        });
      } catch (dbError) {
        log.error({ err: dbError }, `[API] Database error fetching task ${taskIdNum}`);
        context.set.status = 500;
        return { error: "データベースクエリエラーが発生しました", details: dbError instanceof Error ? dbError.message : String(dbError) };
      }

      if (!task) {
        context.set.status = 404;
        return { error: "Task not found" };
      }

      // 二重実行防止: 同じタスクに対してrunning/pendingの実行が既にある場合は拒否
      if (!sessionId) {
        // 新規実行の場合のみチェック（継続実行はsessionId指定で既存セッションを使うため除外）
        try {
          const existingActiveExecution = await prisma.agentExecution.findFirst({
            where: {
              session: {
                config: {
                  taskId: taskIdNum,
                },
              },
              status: { in: ["running", "pending"] },
            },
          });

          if (existingActiveExecution) {
            log.warn(
              `[API] Duplicate execution rejected for task ${taskIdNum}: existing execution #${existingActiveExecution.id} is ${existingActiveExecution.status}`,
            );
            context.set.status = 409;
            return {
              error: "このタスクは既に実行中です。完了後に再実行してください。",
              existingExecutionId: existingActiveExecution.id,
            };
          }
        } catch (dbError) {
          log.error({ err: dbError }, `[API] Failed to check for duplicate executions for task ${taskIdNum}`);
          // チェック失敗時は実行を続行（安全側に倒す）
        }
      }

      // 自動複雑度評価の実行
      if (task.complexityScore === null && !task.workflowModeOverride) {
        log.info(`[API] Auto-analyzing task complexity for task ${taskIdNum}`);
        try {
          const complexityInput = {
            title: task.title,
            description: task.description,
            estimatedHours: task.estimatedHours,
            labels: task.labels ? JSON.parse(task.labels) : [],
            priority: task.priority,
            themeId: task.themeId,
          };

          const analysisResult = analyzeTaskComplexity(complexityInput);

          // DBに結果を保存
          await prisma.task.update({
            where: { id: taskIdNum },
            data: {
              complexityScore: analysisResult.complexityScore,
              workflowMode: analysisResult.recommendedMode,
            },
          });

          // taskオブジェクトも更新（後続の処理で使用）
          task.complexityScore = analysisResult.complexityScore;
          task.workflowMode = analysisResult.recommendedMode;

          log.info(`[API] Task ${taskIdNum} complexity auto-evaluated: score=${analysisResult.complexityScore}, mode=${analysisResult.recommendedMode}`);
        } catch (error) {
          log.error({ err: error }, `[API] Failed to analyze task complexity for task ${taskIdNum}`);
          // エラーが発生してもタスク実行は継続（フォールバック）
        }
      } else if (task.workflowModeOverride) {
        log.info(`[API] Task ${taskIdNum} has workflow mode override, skipping auto-complexity analysis`);
      } else if (task.complexityScore !== null) {
        log.info(`[API] Task ${taskIdNum} already has complexity score: ${task.complexityScore}, skipping analysis`);
      }

      // 開発プロジェクトのテーマに属さず、workingDirectoryも明示指定されていない場合は実行拒否
      if (!task.theme?.isDevelopment && !workingDirectory) {
        log.error(
          `[API] Task ${taskIdNum} rejected: not in a development theme and no workingDirectory specified.`,
        );
        context.set.status = 400;
        return {
          error: "開発プロジェクトに設定されたテーマのタスクのみ実行できます。テーマの設定を確認してください。",
        };
      }

      const workDir =
        workingDirectory || task.theme?.workingDirectory || process.cwd();

      let developerModeConfig = task.developerModeConfig;
      let session;
      let finalBranchName = branchName;

      try {
        if (!developerModeConfig) {
          developerModeConfig = await prisma.developerModeConfig.upsert({
            where: { taskId: taskIdNum },
            update: {},
            create: {
              taskId: taskIdNum,
              isEnabled: true,
            },
          });
        }

        // 継続実行の場合は既存のセッションを使用、なければ新規作成
        if (sessionId) {
          // 既存のセッションを取得して検証
          const existingSession = await prisma.agentSession.findUnique({
            where: { id: sessionId },
          });
          if (!existingSession) {
            context.set.status = 404;
            return { error: "Session not found" };
          }
          if (existingSession.configId !== developerModeConfig.id) {
            context.set.status = 400;
            return { error: "Session does not belong to this task" };
          }
          // セッションを再利用
          session = existingSession;
          log.info(
            `[API] Continuing execution with existing session ${sessionId}`,
          );
        } else {
          // 新規セッション作成
          session = await prisma.agentSession.create({
            data: {
              configId: developerModeConfig.id,
              status: "pending",
            },
          });
          log.info(`[API] Created new session ${session.id}`);
        }

        // ブランチ名の自動生成または手動指定
        if (!finalBranchName) {
          try {
            finalBranchName = await generateBranchName(task.title, task.description || undefined);
            log.info(`[API] Generated branch name: ${finalBranchName} for task ${taskIdNum}`);
          } catch (error) {
            log.error({ err: error }, `[API] Branch name generation failed for task ${taskIdNum}`);
            finalBranchName = `feature/task-${taskIdNum}-auto-generated`;
          }
        }

        // ブランチを作成またはチェックアウト
        const branchCreated = await orchestrator.createBranch(
          workDir,
          finalBranchName,
        );
        if (!branchCreated) {
          return { error: "Failed to create branch", branchName: finalBranchName };
        }

        // セッションにブランチ名を保存
        session = await prisma.agentSession.update({
          where: { id: session.id },
          data: { branchName: finalBranchName },
        });

        await prisma.notification.create({
          data: {
            type: "agent_execution_started",
            title: "エージェント実行開始",
            message: `「${task.title}」の自動実行を開始しました`,
            link: `/tasks/${taskIdNum}`,
            metadata: toJsonString({ sessionId: session.id, taskId: taskIdNum }),
          },
        });

        // タスクのステータスを「進行中」に更新
        await prisma.task.update({
          where: { id: taskIdNum },
          data: {
            status: "in-progress",
            startedAt: task.startedAt || new Date(),
          },
        });
        log.info(`[API] Updated task ${taskIdNum} status to 'in-progress'`);
      } catch (dbError) {
        log.error({ err: dbError }, `[API] Database error during execution setup for task ${taskIdNum}`);
        context.set.status = 500;
        return {
          error: "データベースクエリエラーが発生しました",
          details: dbError instanceof Error ? dbError.message : String(dbError),
        };
      }

      let fullInstruction: string;
      if (optimizedPrompt) {
        fullInstruction = instruction
          ? `${optimizedPrompt}\n\n追加指示:\n${instruction}`
          : optimizedPrompt;
        log.info(`[API] Using optimized prompt for task ${taskIdNum}`);
      } else {
        fullInstruction = instruction
          ? `${task.description || task.title}\n\n追加指示:\n${instruction}`
          : task.description || task.title;
      }

      // 添付ファイル情報を指示に追加
      if (attachments && attachments.length > 0) {
        const attachmentInfo = attachments
          .map((a) => {
            let info = `- ${a.title} (${a.type})`;
            if (a.fileName) info += ` - ファイル名: ${a.fileName}`;
            if (a.description) info += ` - 説明: ${a.description}`;
            if (a.filePath) {
              const fullPath = join(UPLOAD_DIR, a.filePath);
              info += `\n  パス: ${fullPath}`;
            }
            return info;
          })
          .join("\n");
        fullInstruction += `\n\n## 添付ファイル\n以下のファイルがタスクに添付されています。必要に応じて参照してください:\n${attachmentInfo}`;
        log.info(
          `[API] Added ${attachments.length} attachments to instruction`,
        );
      }

      let analysisInfo:
        | {
            summary: string;
            complexity: "simple" | "medium" | "complex";
            estimatedTotalHours: number;
            subtasks: Array<{
              title: string;
              description: string;
              estimatedHours: number;
              priority: "low" | "medium" | "high" | "urgent";
              order: number;
              dependencies?: number[];
            }>;
            reasoning: string;
            tips?: string[];
          }
        | undefined;

      if (useTaskAnalysis && developerModeConfig) {
        try {
          const latestAnalysisAction = await prisma.agentAction.findFirst({
            where: {
              session: {
                configId: developerModeConfig.id,
              },
              actionType: "analysis",
              status: "success",
            },
            orderBy: {
              createdAt: "desc",
            },
          });

          if (latestAnalysisAction?.output) {
            try {
              const analysisOutput = fromJsonString<Record<string, unknown>>(
                latestAnalysisAction.output,
              );
              if (analysisOutput?.summary && analysisOutput?.suggestedSubtasks) {
                analysisInfo = {
                  summary: analysisOutput.summary as string,
                  complexity:
                    (analysisOutput.complexity as
                      | "simple"
                      | "medium"
                      | "complex") || "medium",
                  estimatedTotalHours:
                    (analysisOutput.estimatedTotalHours as number) || 0,
                  subtasks: (
                    (analysisOutput.suggestedSubtasks as Array<{
                      title: string;
                      description?: string;
                      estimatedHours?: number;
                      priority?: string;
                      order?: number;
                      dependencies?: number[];
                    }>) || []
                  ).map((st) => ({
                    title: st.title,
                    description: st.description || "",
                    estimatedHours: st.estimatedHours || 0,
                    priority:
                      (st.priority as "low" | "medium" | "high" | "urgent") ||
                      "medium",
                    order: st.order || 0,
                    dependencies: st.dependencies,
                  })),
                  reasoning: (analysisOutput.reasoning as string) || "",
                  tips: analysisOutput.tips as string[] | undefined,
                };
                log.info(`[API] Using AI task analysis for task ${taskIdNum}`);
                log.info(
                  `[API] Analysis subtasks count: ${analysisInfo!.subtasks.length}`,
                );
              }
            } catch (e) {
              log.error({ err: e }, `[API] Failed to parse analysis result`);
            }
          } else {
            log.info(`[API] No analysis result found for task ${taskIdNum}`);
          }
        } catch (dbError) {
          log.error({ err: dbError }, `[API] Failed to fetch analysis action for task ${taskIdNum}`);
          // 分析データ取得失敗時は分析なしで実行を継続
        }
      }

      // Execute Claude Code asynchronously
      orchestrator
        .executeTask(
          {
            id: taskIdNum,
            title: task.title,
            description: fullInstruction,
            context: task.executionInstructions || undefined,
            workingDirectory: workDir,
          },
          {
            taskId: taskIdNum,
            sessionId: session.id,
            agentConfigId,
            workingDirectory: workDir,
            timeout,
            analysisInfo,
          },
        )
        .then(async (result) => {
          if (result.waitingForInput) {
            // 質問待ち状態: タスクは実行中のまま維持
            log.info(
              `[API] Task ${taskIdNum} is waiting for user input, keeping status as 'in_progress'`,
            );
            await prisma.task
              .update({
                where: { id: taskIdNum },
                data: { status: "in_progress" },
              })
              .catch((e: unknown) => {
                log.error({ err: e }, `[API] Failed to update task ${taskIdNum} status to in_progress`);
              });

            // セッションも実行中のまま維持
            await prisma.agentSession
              .update({
                where: { id: session.id },
                data: {
                  status: "running",
                  lastActivityAt: new Date(),
                },
              })
              .catch((e: unknown) => {
                log.error({ err: e }, `[API] Failed to update session ${session.id} status to running`);
              });
          } else if (result.success) {
            // ワークフローステータスに基づいてタスクステータスを決定
            try {
              const currentTask = await prisma.task.findUnique({
                where: { id: taskIdNum },
              });
              const wfStatus = currentTask?.workflowStatus;
              if (
                wfStatus === "plan_created" ||
                wfStatus === "research_done" ||
                wfStatus === "verify_done"
              ) {
                // 承認待ち・確認待ちフェーズではdoneにしない
                try {
                  await prisma.task.update({
                    where: { id: taskIdNum },
                    data: { status: "in-progress" },
                  });
                  log.info(
                    `[API] Task ${taskIdNum} kept as in-progress (workflow: ${wfStatus})`,
                  );
                } catch (updateError) {
                  log.error({ err: updateError }, `[API] Failed to update task ${taskIdNum} status to in-progress`);
                }
              } else if (
                wfStatus === "in_progress" ||
                wfStatus === "plan_approved" ||
                wfStatus === "completed"
              ) {
                // 実行が成功完了したらタスクをdoneに更新
                try {
                  await prisma.task.update({
                    where: { id: taskIdNum },
                    data: { status: "done", completedAt: new Date() },
                  });
                  log.info(
                    `[API] Updated task ${taskIdNum} status to 'done' (workflow: ${wfStatus})`,
                  );
                } catch (updateError) {
                  log.error({ err: updateError }, `[API] Failed to update task ${taskIdNum} status to done`);
                }
              } else if (!wfStatus || wfStatus === "draft") {
                // ワークフロー未使用タスク、または初期状態は従来通り
                try {
                  await prisma.task.update({
                    where: { id: taskIdNum },
                    data: { status: "done", completedAt: new Date() },
                  });
                  log.info(`[API] Updated task ${taskIdNum} status to 'done'`);
                } catch (updateError) {
                  log.error({ err: updateError }, `[API] Failed to update task ${taskIdNum} status to done`);
                }
              } else {
                // 未知のワークフローステータス: 安全のためin-progressを維持
                log.info(
                  `[API] Task ${taskIdNum} kept as in-progress (unknown workflow status: ${wfStatus})`,
                );
              }
            } catch (taskError) {
              log.error({ err: taskError }, `[API] Failed to fetch or update task ${taskIdNum}`);
            }

            // セッションのステータスも完了に更新（リトライ付き）
            await updateSessionStatusWithRetry(
              session.id,
              "completed",
              "[API]",
              3
            );

            // コードレビュー承認リクエスト作成（autoApprove対応）
            await createCodeReviewApproval({
              taskId: taskIdNum,
              taskTitle: task.title,
              configId: developerModeConfig!.id,
              sessionId: session.id,
              workDir,
              branchName,
              resultOutput: result.output,
              executionTimeMs: result.executionTimeMs,
              logPrefix: "[API]",
            });
          } else {
            // エラーが発生した場合
            log.error({ errorMessage: result.errorMessage }, `[API] Execution failed for task ${taskIdNum}`);
            try {
              await prisma.task.update({
                where: { id: taskIdNum },
                data: { status: "todo" },
              });
            } catch (updateError) {
              log.error({ err: updateError }, `[API] Failed to update task ${taskIdNum} status to todo after execution failure`);
            }

            await prisma.agentSession
              .update({
                where: { id: session.id },
                data: {
                  status: "failed",
                  completedAt: new Date(),
                  errorMessage: result.errorMessage || "Execution failed",
                },
              })
              .catch((e: unknown) => {
                log.error({ err: e }, `[API] Failed to update session ${session.id} status to failed`);
              });
          }
        })
        .catch(async (error) => {
          log.error({ err: error }, `[API] Execution error for task ${taskIdNum}`);
          await prisma.task.update({
            where: { id: taskIdNum },
            data: { status: "todo" },
          });

          await prisma.agentSession
            .update({
              where: { id: session.id },
              data: {
                status: "failed",
                completedAt: new Date(),
                errorMessage: error.message || "Execution error",
              },
            })
            .catch((e: unknown) => {
              log.error({ err: e }, `[API] Failed to update session ${session.id} status to failed`);
            });
        });

      return {
        success: true,
        message: "Task execution started",
        sessionId: session.id,
        taskId: taskIdNum,
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Get task execution status
  .get(
    "/tasks/:id/execution-status",
    async (context) => {
      const { params } = context;
      try {
        const taskId = parseInt(params.id);

        const config = await prisma.developerModeConfig.findUnique({
          where: { taskId },
          include: {
            agentSessions: {
              orderBy: { createdAt: "desc" },
              take: 1,
              include: {
                agentExecutions: {
                  orderBy: { createdAt: "desc" },
                  take: 1,
                  include: {
                    agentConfig: {
                      select: {
                        id: true,
                        agentType: true,
                        name: true,
                        modelId: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

        if (!config || !config.agentSessions[0]) {
          return { status: "none", message: "実行履歴がありません" };
        }

        const latestSession = config.agentSessions[0];
        const latestExecution = latestSession.agentExecutions[0];
        const execExtras = latestExecution as typeof latestExecution &
          AgentExecutionWithExtras;

        const isWaitingForInput = latestExecution?.status === "waiting_for_input";
        const questionText = execExtras?.question || null;
        const questionType: "tool_call" | "none" =
          execExtras?.questionType === "tool_call" ? "tool_call" : "none";

        // タイムアウト情報を取得
        let questionTimeoutInfo = null;
        if (isWaitingForInput && latestExecution?.id) {
          const timeoutInfo = orchestrator.getQuestionTimeoutInfo(
            latestExecution.id,
          );
          if (timeoutInfo) {
            questionTimeoutInfo = {
              remainingSeconds: timeoutInfo.remainingSeconds,
              deadline: timeoutInfo.deadline.toISOString(),
              totalSeconds: timeoutInfo.questionKey?.timeout_seconds || 300,
            };
          }
        }

        // エージェント設定情報を取得
        const agentConfigInfo = (latestExecution as Record<string, unknown>)
          ?.agentConfig as {
          id: number;
          agentType: string;
          name: string;
          modelId: string | null;
        } | null;

        return {
          sessionId: latestSession.id,
          sessionStatus: latestSession.status,
          sessionMode: latestSession.mode || null,
          executionId: latestExecution?.id,
          executionStatus: latestExecution?.status,
          output: latestExecution?.output,
          errorMessage: latestExecution?.errorMessage,
          startedAt: latestExecution?.startedAt,
          completedAt: latestExecution?.completedAt,
          waitingForInput: isWaitingForInput,
          question: questionText,
          questionType,
          questionTimeout: questionTimeoutInfo,
          claudeSessionId: execExtras?.claudeSessionId || null,
          agentConfig: agentConfigInfo || null,
        };
      } catch (error) {
        log.error({ err: error }, "[execution-status] Error fetching status");
        return {
          status: "error",
          message: "状態の取得中にエラーが発生しました",
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Respond to agent (answer question)
  .post(
    "/tasks/:id/agent-respond",
    async (context) => {
      const params = context.params as { id: string };
      const body = context.body as { response: string };
      const taskId = parseInt(params.id);
      const { response } = body;

      if (!response?.trim()) {
        return { error: "Response is required" };
      }

      try {
        // 実行情報を取得してロックとタイムアウトキャンセルを試みる
        const config = await prisma.developerModeConfig.findUnique({
          where: { taskId },
          include: {
            task: { include: { theme: true } },
            agentSessions: {
              orderBy: { createdAt: "desc" },
              take: 1,
              include: {
                agentExecutions: {
                  orderBy: { createdAt: "desc" },
                  take: 1,
                },
              },
            },
          },
        });

        if (!config || !config.agentSessions[0]) {
          return { error: "No active session found" };
        }

        const session = config.agentSessions[0];
        const latestExecution = session.agentExecutions[0];

        if (!latestExecution) {
          return { error: "No execution found" };
        }

        // ステータスチェック: waiting_for_input でなければ応答不可
        if (latestExecution.status === "running") {
          return { error: "Execution is already running" };
        }
        if (latestExecution.status !== "waiting_for_input") {
          return {
            error: `Execution is not waiting for input: ${latestExecution.status}`,
          };
        }

        // オーケストレーターでロックを取得（他のプロセスと競合防止）
        if (
          !orchestrator.tryAcquireContinuationLock(
            latestExecution.id,
            "user_response",
          )
        ) {
          return {
            error: "Another operation is in progress for this execution",
          };
        }

        // タイムアウトキャンセルを試行
        orchestrator.cancelQuestionTimeout(latestExecution.id);
        log.info(
          `[agent-respond] Cancelled timeout for execution ${latestExecution.id}`,
        );

        const workingDirectory =
          config.task.theme?.workingDirectory || process.cwd();

        // 応答を送信（ロック取得済みなので executeContinuationWithLock を使用）
        // executeContinuationWithLock が finally でロックを解放する
        const result = await orchestrator.executeContinuationWithLock(
          latestExecution.id,
          response,
          {
            sessionId: session.id,
            taskId,
            workingDirectory,
          },
        );

        if (result.success) {
          return {
            success: true,
            message: "Response sent successfully",
            executionId: latestExecution.id,
          };
        } else {
          return {
            error: result.errorMessage || "Failed to send response",
            executionId: latestExecution.id,
          };
        }
      } catch (error) {
        log.error({ err: error }, "[agent-respond] Database error");
        return {
          error: "データベースエラーが発生しました。応答の送信に失敗しました。",
          message: "Failed to send agent response due to database error",
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Stop task execution (rollback changes)
  .post(
    "/tasks/:id/stop-execution",
    async (context) => {
      const { params } = context;
      const taskId = parseInt(params.id);

      try {
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          select: { workingDirectory: true },
        });

        const config = await prisma.developerModeConfig.findUnique({
          where: { taskId },
          include: {
            agentSessions: {
              where: {
                status: { in: ["running", "pending"] },
              },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        });

        if (!config || config.agentSessions.length === 0) {
          const runningExecution = await prisma.agentExecution.findFirst({
            where: {
              session: {
                config: {
                  taskId,
                },
              },
              status: { in: ["running", "pending", "waiting_for_input"] },
            },
            orderBy: { createdAt: "desc" },
          });

          if (runningExecution) {
            // オーケストレーターで停止を試みる
            const stopped = await orchestrator
              .stopExecution(runningExecution.id)
              .catch(() => false);

            try {
              // 実行ログを削除
              await prisma.agentExecutionLog.deleteMany({
                where: { executionId: runningExecution.id },
              });
              log.info(
                `[stop-execution] Deleted execution logs for execution ${runningExecution.id}`,
              );
            } catch (deleteError) {
              log.error({ err: deleteError }, `[stop-execution] Failed to delete execution logs for execution ${runningExecution.id}`);
            }

            // オーケストレーターで停止できなかった場合でも DBのステータスを確実に更新
            if (!stopped) {
              try {
                await prisma.agentExecution.update({
                  where: { id: runningExecution.id },
                  data: {
                    status: "cancelled",
                    completedAt: new Date(),
                    errorMessage: "Cancelled by user",
                  },
                });
                log.info(
                  `[stop-execution] Updated DB status for execution ${runningExecution.id} (not found in orchestrator)`,
                );
              } catch (updateError) {
                log.error({ err: updateError }, `[stop-execution] Failed to update execution ${runningExecution.id} status`);
              }
            }

            if (task?.workingDirectory) {
              try {
                await orchestrator.revertChanges(task.workingDirectory);
                log.info(
                  `[stop-execution] Reverted changes in ${task.workingDirectory}`,
                );
              } catch (revertError) {
                log.error({ err: revertError }, `[stop-execution] Failed to revert changes`);
              }
            }

            return {
              success: true,
              message: "Execution cancelled and changes reverted",
            };
          }

          return { success: false, message: "No running execution found" };
        }

        const session = config.agentSessions[0];

        const executions = orchestrator.getSessionExecutions(session.id);
        for (const execution of executions) {
          await orchestrator.stopExecution(execution.executionId);
        }

        const pendingExecutions = await prisma.agentExecution.findMany({
          where: {
            sessionId: session.id,
            status: { in: ["running", "pending", "waiting_for_input"] },
          },
        });

        for (const execution of pendingExecutions) {
          try {
            // 実行ログを削除
            await prisma.agentExecutionLog.deleteMany({
              where: { executionId: execution.id },
            });

            await prisma.agentExecution.update({
              where: { id: execution.id },
              data: {
                status: "cancelled",
                completedAt: new Date(),
                errorMessage: "Cancelled by user",
              },
            });
          } catch (executionUpdateError) {
            log.error({ err: executionUpdateError }, `[stop-execution] Failed to update execution ${execution.id}`);
            // 個別のエラーは継続（他の実行の停止処理は継続）
          }
        }

        try {
          await prisma.agentSession.update({
            where: { id: session.id },
            data: {
              status: "failed",
              completedAt: new Date(),
              errorMessage: "Cancelled by user",
            },
          });
        } catch (sessionUpdateError) {
          log.error({ err: sessionUpdateError }, `[stop-execution] Failed to update session ${session.id} status`);
        }

        if (task?.workingDirectory) {
          try {
            await orchestrator.revertChanges(task.workingDirectory);
            log.info(
              `[stop-execution] Reverted changes in ${task.workingDirectory}`,
            );
          } catch (revertError) {
            log.error({ err: revertError }, `[stop-execution] Failed to revert changes`);
          }
        }

        return {
          success: true,
          sessionId: session.id,
          message: "Execution stopped and changes reverted",
        };
      } catch (error) {
        log.error({ err: error }, "[stop-execution] Database error");
        return {
          success: false,
          error: "データベースエラーが発生しました。実行の停止に失敗しました。",
          message: "Failed to stop execution due to database error",
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Continue execution with additional instruction
  .post(
    "/tasks/:id/continue-execution",
    async (context) => {
      const taskId = parseInt(context.params.id);
      const { instruction, sessionId, agentConfigId } = context.body as {
        instruction?: string;
        sessionId?: number;
        agentConfigId?: number;
      };

      if (!instruction?.trim()) {
        context.set.status = 400;
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
          context.set.status = 404;
          return { error: "Task not found" };
        }

        // セッションIDが指定されていない場合は最新の完了済み/失敗/中断セッションを取得
        let targetSessionId = sessionId;
        if (!targetSessionId && task.developerModeConfig) {
          const latestSession = await prisma.agentSession.findFirst({
            where: {
              configId: task.developerModeConfig.id,
              status: { in: ["completed", "failed", "interrupted"] },
            },
            orderBy: { createdAt: "desc" },
          });

          if (latestSession) {
            targetSessionId = latestSession.id;
          }
        }

        if (!targetSessionId) {
          context.set.status = 404;
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
          context.set.status = 404;
          return { error: "Session not found" };
        }

        // セッションのステータスをログに出力（デバッグ用）
        log.info(
          `[continue-execution] Session ${targetSessionId} status: "${session.status}"`,
        );

        // 現在実行中のエージェントがある場合のみ拒否（二重実行防止）
        const activeCount = orchestrator.getActiveExecutionCount();
        const hasRunningExecution = session.agentExecutions.some(
          (e: { status: string }) => e.status === "running" || e.status === "pending",
        );
        if (hasRunningExecution && activeCount > 0) {
          context.set.status = 409;
          return { error: "An execution is already running for this session" };
        }

        // 前回の実行情報を取得
        const previousExecution = session.agentExecutions[0];
        const workingDirectory = task.theme?.workingDirectory || process.cwd();

        // セッションのブランチ名を取得し、必要に応じてチェックアウト
        if (session.branchName) {
          try {
            const branchCreated = await orchestrator.createBranch(
              workingDirectory,
              session.branchName,
            );
            if (!branchCreated) {
              log.error(
                `[continue-execution] Failed to checkout branch ${session.branchName} for task ${taskId}`,
              );
              // ブランチチェックアウト失敗は警告のみで継続
            } else {
              log.info(
                `[continue-execution] Checked out branch ${session.branchName} for task ${taskId}`,
              );
            }
          } catch (error) {
            log.error({ err: error }, `[continue-execution] Branch checkout error for task ${taskId}`);
            // ブランチチェックアウト失敗は警告のみで継続
          }
        } else {
          log.info(
            `[continue-execution] No branch name stored in session ${targetSessionId}`,
          );
        }

        // セッションを再開状態に更新
        try {
          await prisma.agentSession.update({
            where: { id: targetSessionId },
            data: {
              status: "running",
              lastActivityAt: new Date(),
            },
          });
        } catch (dbError) {
          log.error({ err: dbError }, `[continue-execution] Failed to update session ${targetSessionId} status`);
          // セッション更新失敗でも実行は継続
        }

        // タスクのステータスを「進行中」に更新
        try {
          await prisma.task.update({
            where: { id: taskId },
            data: {
              status: "in-progress",
            },
          });
        } catch (dbError) {
          log.error({ err: dbError }, `[continue-execution] Failed to update task ${taskId} status`);
          // タスク更新失敗でも実行は継続
        }

        log.info(
          `[continue-execution] Continuing execution for task ${taskId} in session ${targetSessionId}`,
        );

        // 通知を作成
        try {
          await prisma.notification.create({
            data: {
              type: "agent_execution_continued",
              title: "追加指示実行開始",
              message: `「${task.title}」に追加指示を実行しています`,
              link: `/tasks/${taskId}`,
              metadata: toJsonString({ sessionId: targetSessionId, taskId }),
            },
          });
        } catch (dbError) {
          log.error({ err: dbError }, `[continue-execution] Failed to create notification for task ${taskId}`);
          // 通知作成失敗でも実行は継続
        }

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
              // ワークフローステータスに基づいてタスクステータスを決定
              try {
                const currentTask = await prisma.task.findUnique({
                  where: { id: taskId },
                });
                const wfStatus = currentTask?.workflowStatus;
                if (
                  wfStatus &&
                  ["plan_created", "research_done", "verify_done"].includes(
                    wfStatus,
                  )
                ) {
                  // 承認待ち・確認待ちフェーズではdoneにしない
                  try {
                    await prisma.task.update({
                      where: { id: taskId },
                      data: { status: "in-progress" },
                    });
                  } catch (updateError) {
                    log.error({ err: updateError }, `[continue-execution] Failed to update task ${taskId} status to in-progress`);
                  }
                } else if (
                  wfStatus === "in_progress" ||
                  wfStatus === "plan_approved" ||
                  wfStatus === "completed"
                ) {
                  // 実行が成功完了したらタスクをdoneに更新
                  try {
                    await prisma.task.update({
                      where: { id: taskId },
                      data: { status: "done", completedAt: new Date() },
                    });
                  } catch (updateError) {
                    log.error({ err: updateError }, `[continue-execution] Failed to update task ${taskId} status to done`);
                  }
                } else if (!wfStatus || wfStatus === "draft") {
                  // ワークフロー未使用タスク、または初期状態は従来通り
                  try {
                    await prisma.task.update({
                      where: { id: taskId },
                      data: { status: "done", completedAt: new Date() },
                    });
                  } catch (updateError) {
                    log.error({ err: updateError }, `[continue-execution] Failed to update task ${taskId} status to done`);
                  }
                }
              } catch (taskError) {
                log.error({ err: taskError }, `[continue-execution] Failed to fetch or update task ${taskId}`);
              }

              // セッションのステータスも完了に更新（リトライ付き）
              await updateSessionStatusWithRetry(
                targetSessionId,
                "completed",
                "[continue-execution]",
                3
              );

              // コードレビュー承認リクエスト作成（autoApprove対応）
              if (task.developerModeConfig) {
                await createCodeReviewApproval({
                  taskId,
                  taskTitle: task.title,
                  configId: task.developerModeConfig.id,
                  sessionId: targetSessionId,
                  workDir: workingDirectory,
                  branchName: session.branchName || undefined,
                  resultOutput: result.output,
                  executionTimeMs: result.executionTimeMs,
                  logPrefix: "[continue-execution]",
                });
              }

              log.info(`[continue-execution] Completed task ${taskId}`);
            } else {
              // エラーが発生した場合
              log.error({ errorMessage: result.errorMessage },
                `[continue-execution] Failed for task ${taskId}`,
              );
              try {
                await prisma.task.update({
                  where: { id: taskId },
                  data: { status: "todo" },
                });
              } catch (updateError) {
                log.error({ err: updateError }, `[continue-execution] Failed to update task ${taskId} status to todo after failure`);
              }

              await prisma.agentSession
                .update({
                  where: { id: targetSessionId },
                  data: {
                    status: "failed",
                    completedAt: new Date(),
                    errorMessage: result.errorMessage || "Continuation failed",
                  },
                })
                .catch((e: unknown) => {
                  log.error({ err: e }, `[continue-execution] Failed to update session ${targetSessionId} status to failed`);
                });
            }
          })
          .catch(async (error) => {
            log.error({ err: error }, `[continue-execution] Execution error for task ${taskId}`);
            try {
              await prisma.task.update({
                where: { id: taskId },
                data: { status: "todo" },
              });
            } catch (updateError) {
              log.error({ err: updateError }, `[continue-execution] Failed to update task ${taskId} status to todo after execution error`);
            }

            await prisma.agentSession
              .update({
                where: { id: targetSessionId },
                data: {
                  status: "failed",
                  completedAt: new Date(),
                  errorMessage: error.message || "Continuation error",
                },
              })
              .catch((e: unknown) => {
                log.error({ err: e }, `[continue-execution] Failed to update session ${targetSessionId} status to failed`);
              });
          });

        return {
          success: true,
          message: "Continuation started",
          sessionId: targetSessionId,
          taskId,
        };
      } catch (error) {
        log.error({ err: error }, `[continue-execution] Error`);
        context.set.status = 500;
        return { error: "Internal server error" };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Reset execution state
  .post(
    "/tasks/:id/reset-execution-state",
    async (context) => {
      const { params } = context;
      const taskId = parseInt(params.id);

      try {
        const config = await prisma.developerModeConfig.findUnique({
          where: { taskId },
          include: {
            agentSessions: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        });

        if (!config) {
          return { error: "No developer mode config found for this task" };
        }

        // 実行中のセッションがある場合は停止
        if (config.agentSessions.length > 0) {
          const latestSession = config.agentSessions[0];

          if (["running", "pending"].includes(latestSession.status)) {
            // アクティブな実行を停止
            const executions = orchestrator.getSessionExecutions(latestSession.id);
            for (const execution of executions) {
              await orchestrator.stopExecution(execution.executionId);
            }

            // DBの実行記録を更新
            const pendingExecutions = await prisma.agentExecution.findMany({
              where: {
                sessionId: latestSession.id,
                status: { in: ["running", "pending", "waiting_for_input"] },
              },
            });

            for (const execution of pendingExecutions) {
              await prisma.agentExecutionLog.deleteMany({
                where: { executionId: execution.id },
              });

              await prisma.agentExecution.update({
                where: { id: execution.id },
                data: {
                  status: "cancelled",
                  completedAt: new Date(),
                  errorMessage: "Reset by user",
                },
              });
            }

            await prisma.agentSession.update({
              where: { id: latestSession.id },
              data: {
                status: "cancelled",
                completedAt: new Date(),
                errorMessage: "Reset by user",
              },
            });
          }
        }

        // タスクのステータスをtodoに戻す
        await prisma.task.update({
          where: { id: taskId },
          data: {
            status: "todo",
            startedAt: null,
            completedAt: null,
          },
        });

        log.info(`[reset-execution-state] Reset execution state for task ${taskId}`);

        return {
          success: true,
          message: "Execution state reset successfully",
          taskId,
        };
      } catch (error) {
        log.error({ err: error }, `[reset-execution-state] Error`);
        return { error: "Failed to reset execution state" };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );