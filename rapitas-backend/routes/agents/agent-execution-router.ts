/**
 * Agent Execution Router
 * タスク実行機能（実行開始・停止・継続・ステータス確認・エージェント応答）
 */
import { Elysia, t } from "elysia";
import { join } from "path";
import { prisma } from "../../config/database";
import { orchestrator } from "../approvals";
import { toJsonString, fromJsonString } from "../../utils/db-helpers";
import {
  cleanImplementationSummary,
  sanitizeScreenshots,
} from "../../utils/agent-response-cleaner";
import { captureScreenshotsForDiff } from "../../services/screenshot-service";
import { generateBranchName } from "../../utils/branch-name-generator";
import type { ExecutionWithExtras } from "../../types/agent-execution-types";
import type { ScreenshotResult } from "../../services/screenshot-service";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";

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

      const task = await prisma.task.findUnique({
        where: { id: taskIdNum },
        include: {
          developerModeConfig: true,
          theme: true,
        },
      });

      if (!task) {
        context.set.status = 404;
        return { error: "Task not found" };
      }

      const workDir =
        workingDirectory || task.theme?.workingDirectory || process.cwd();

      if (!task.theme?.isDevelopment && !workingDirectory) {
        console.warn(
          `Task ${taskIdNum} is not in a development theme. Using current directory.`,
        );
      }

      let developerModeConfig = task.developerModeConfig;
      if (!developerModeConfig) {
        developerModeConfig = await prisma.developerModeConfig.create({
          data: {
            taskId: taskIdNum,
            isEnabled: true,
          },
        });
      }

      // 継続実行の場合は既存のセッションを使用、なければ新規作成
      let session;
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
        console.log(
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
        console.log(`[API] Created new session ${session.id}`);
      }

      // ブランチ名の自動生成または手動指定
      let finalBranchName = branchName;
      if (!finalBranchName) {
        try {
          finalBranchName = await generateBranchName(task.title, task.description || undefined);
          console.log(`[API] Generated branch name: ${finalBranchName} for task ${taskIdNum}`);
        } catch (error) {
          console.error(`[API] Branch name generation failed for task ${taskIdNum}:`, error);
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
      console.log(`[API] Updated task ${taskIdNum} status to 'in-progress'`);

      let fullInstruction: string;
      if (optimizedPrompt) {
        fullInstruction = instruction
          ? `${optimizedPrompt}\n\n追加指示:\n${instruction}`
          : optimizedPrompt;
        console.log(`[API] Using optimized prompt for task ${taskIdNum}`);
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
        console.log(
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
              console.log(`[API] Using AI task analysis for task ${taskIdNum}`);
              console.log(
                `[API] Analysis subtasks count: ${analysisInfo!.subtasks.length}`,
              );
            }
          } catch (e) {
            console.error(`[API] Failed to parse analysis result:`, e);
          }
        } else {
          console.log(`[API] No analysis result found for task ${taskIdNum}`);
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
            console.log(
              `[API] Task ${taskIdNum} is waiting for user input, keeping status as 'in_progress'`,
            );
            await prisma.task
              .update({
                where: { id: taskIdNum },
                data: { status: "in_progress" },
              })
              .catch((e: unknown) => {
                console.error(
                  `[API] Failed to update task ${taskIdNum} status to in_progress:`,
                  e,
                );
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
                console.error(
                  `[API] Failed to update session ${session.id} status to running:`,
                  e,
                );
              });
          } else if (result.success) {
            // ワークフローステータスに基づいてタスクステータスを決定
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
              await prisma.task.update({
                where: { id: taskIdNum },
                data: { status: "in-progress" },
              });
              console.log(
                `[API] Task ${taskIdNum} kept as in-progress (workflow: ${wfStatus})`,
              );
            } else if (
              wfStatus === "in_progress" ||
              wfStatus === "plan_approved"
            ) {
              // 実装中・承認済みはそのまま維持
              console.log(
                `[API] Task ${taskIdNum} kept as in-progress (workflow: ${wfStatus})`,
              );
            } else if (wfStatus === "completed") {
              await prisma.task.update({
                where: { id: taskIdNum },
                data: { status: "done", completedAt: new Date() },
              });
              console.log(
                `[API] Updated task ${taskIdNum} status to 'done' (workflow completed)`,
              );
            } else if (!wfStatus || wfStatus === "draft") {
              // ワークフロー未使用タスク、または初期状態は従来通り
              await prisma.task.update({
                where: { id: taskIdNum },
                data: { status: "done", completedAt: new Date() },
              });
              console.log(`[API] Updated task ${taskIdNum} status to 'done'`);
            } else {
              // 未知のワークフローステータス: 安全のためin-progressを維持
              console.log(
                `[API] Task ${taskIdNum} kept as in-progress (unknown workflow status: ${wfStatus})`,
              );
            }

            // セッションのステータスも完了に更新
            await prisma.agentSession
              .update({
                where: { id: session.id },
                data: {
                  status: "completed",
                  completedAt: new Date(),
                },
              })
              .catch((e: unknown) => {
                console.error(
                  `[API] Failed to update session ${session.id} status:`,
                  e,
                );
              });

            const diff = await orchestrator.getFullGitDiff(workDir);
            const structuredDiff = await orchestrator.getDiff(workDir);

            if (diff && diff !== "No changes detected") {
              const implementationSummary = cleanImplementationSummary(
                result.output || "実装が完了しました。",
              );

              // UI変更がある場合はスクリーンショットを撮影
              let screenshots: ScreenshotResult[] = [];
              try {
                screenshots = await captureScreenshotsForDiff(structuredDiff, {
                  workingDirectory: workDir,
                  agentOutput: result.output || "",
                });
                if (screenshots.length > 0) {
                  console.log(
                    `[API] Captured ${screenshots.length} screenshots for task ${taskIdNum}: ${screenshots.map((s) => s.page).join(", ")}`,
                  );
                }
              } catch (screenshotErr) {
                console.warn(
                  "[API] Screenshot capture failed (non-fatal):",
                  screenshotErr,
                );
              }

              const screenshotData = sanitizeScreenshots(screenshots);
              console.log(
                `[API] Creating approval with ${screenshotData.length} screenshot(s): ${screenshotData.map((s) => s.url).join(", ")}`,
              );

              const approvalRequest = await prisma.approvalRequest.create({
                data: {
                  configId: developerModeConfig!.id,
                  requestType: "code_review",
                  title: `「${task.title}」のコードレビュー`,
                  description: implementationSummary,
                  proposedChanges: toJsonString({
                    taskId: taskIdNum,
                    sessionId: session.id,
                    workingDirectory: workDir,
                    branchName,
                    structuredDiff,
                    implementationSummary,
                    executionTimeMs: result.executionTimeMs,
                    screenshots: screenshotData,
                  }),
                  executionType: "code_review",
                  estimatedChanges: toJsonString({
                    filesChanged: structuredDiff.length,
                    summary: implementationSummary.substring(0, 500),
                  }),
                },
              });
            }
          } else {
            // エラーが発生した場合
            console.error(`[API] Execution failed for task ${taskIdNum}:`, result.errorMessage);
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
                  errorMessage: result.errorMessage || "Execution failed",
                },
              })
              .catch((e: unknown) => {
                console.error(
                  `[API] Failed to update session ${session.id} status to failed:`,
                  e,
                );
              });
          }
        })
        .catch(async (error) => {
          console.error(`[API] Execution error for task ${taskIdNum}:`, error);
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
              console.error(
                `[API] Failed to update session ${session.id} status to failed:`,
                e,
              );
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
    async (context: any) => {
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
          ExecutionWithExtras;

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
        console.error("[execution-status] Error fetching status:", error);
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
      console.log(
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
    async (context: any) => {
      const { params } = context;
      const taskId = parseInt(params.id);

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

          // 実行ログを削除
          await prisma.agentExecutionLog.deleteMany({
            where: { executionId: runningExecution.id },
          });
          console.log(
            `[stop-execution] Deleted execution logs for execution ${runningExecution.id}`,
          );

          // オーケストレーターで停止できなかった場合でも DBのステータスを確実に更新
          if (!stopped) {
            await prisma.agentExecution.update({
              where: { id: runningExecution.id },
              data: {
                status: "cancelled",
                completedAt: new Date(),
                errorMessage: "Cancelled by user",
              },
            });
            console.log(
              `[stop-execution] Updated DB status for execution ${runningExecution.id} (not found in orchestrator)`,
            );
          }

          if (task?.workingDirectory) {
            try {
              await orchestrator.revertChanges(task.workingDirectory);
              console.log(
                `[stop-execution] Reverted changes in ${task.workingDirectory}`,
              );
            } catch (revertError) {
              console.error(
                `[stop-execution] Failed to revert changes:`,
                revertError,
              );
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
      }

      await prisma.agentSession.update({
        where: { id: session.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          errorMessage: "Cancelled by user",
        },
      });

      if (task?.workingDirectory) {
        try {
          await orchestrator.revertChanges(task.workingDirectory);
          console.log(
            `[stop-execution] Reverted changes in ${task.workingDirectory}`,
          );
        } catch (revertError) {
          console.error(
            `[stop-execution] Failed to revert changes:`,
            revertError,
          );
        }
      }

      return {
        success: true,
        sessionId: session.id,
        message: "Execution stopped and changes reverted",
      };
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
      const { instruction, sessionId, agentConfigId } = context.body as any;

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

        if (session.status !== "completed") {
          context.set.status = 400;
          return { error: "Can only continue from completed sessions" };
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
              console.error(
                `[continue-execution] Failed to checkout branch ${session.branchName} for task ${taskId}`,
              );
              // ブランチチェックアウト失敗は警告のみで継続
            } else {
              console.log(
                `[continue-execution] Checked out branch ${session.branchName} for task ${taskId}`,
              );
            }
          } catch (error) {
            console.error(
              `[continue-execution] Branch checkout error for task ${taskId}:`,
              error,
            );
            // ブランチチェックアウト失敗は警告のみで継続
          }
        } else {
          console.log(
            `[continue-execution] No branch name stored in session ${targetSessionId}`,
          );
        }

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
              // ワークフローステータスに基づいてタスクステータスを決定
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
                await prisma.task.update({
                  where: { id: taskId },
                  data: { status: "in-progress" },
                });
              } else if (
                wfStatus === "in_progress" ||
                wfStatus === "plan_approved"
              ) {
                // 実装中・承認済みはそのまま維持
              } else if (wfStatus === "completed") {
                await prisma.task.update({
                  where: { id: taskId },
                  data: { status: "done", completedAt: new Date() },
                });
              } else if (!wfStatus || wfStatus === "draft") {
                // ワークフロー未使用タスク、または初期状態は従来通り
                await prisma.task.update({
                  where: { id: taskId },
                  data: { status: "done", completedAt: new Date() },
                });
              }

              // セッションのステータスも完了に更新
              await prisma.agentSession
                .update({
                  where: { id: targetSessionId },
                  data: {
                    status: "completed",
                    completedAt: new Date(),
                  },
                })
                .catch((e: unknown) => {
                  console.error(
                    `[continue-execution] Failed to update session ${targetSessionId} status:`,
                    e,
                  );
                });

              console.log(`[continue-execution] Completed task ${taskId}`);
            } else {
              // エラーが発生した場合
              console.error(
                `[continue-execution] Failed for task ${taskId}:`,
                result.errorMessage,
              );
              await prisma.task.update({
                where: { id: taskId },
                data: { status: "todo" },
              });

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
                  console.error(
                    `[continue-execution] Failed to update session ${targetSessionId} status to failed:`,
                    e,
                  );
                });
            }
          })
          .catch(async (error) => {
            console.error(
              `[continue-execution] Execution error for task ${taskId}:`,
              error,
            );
            await prisma.task.update({
              where: { id: taskId },
              data: { status: "todo" },
            });

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
                console.error(
                  `[continue-execution] Failed to update session ${targetSessionId} status to failed:`,
                  e,
                );
              });
          });

        return {
          success: true,
          message: "Continuation started",
          sessionId: targetSessionId,
          taskId,
        };
      } catch (error) {
        console.error(`[continue-execution] Error:`, error);
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
    async (context: any) => {
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

        console.log(`[reset-execution-state] Reset execution state for task ${taskId}`);

        return {
          success: true,
          message: "Execution state reset successfully",
          taskId,
        };
      } catch (error) {
        console.error(`[reset-execution-state] Error:`, error);
        return { error: "Failed to reset execution state" };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );