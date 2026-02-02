/**
 * AI Agent API Routes
 * Agent configuration, task execution, and session management
 */
import { Elysia } from "elysia";
import { prisma } from "../config/database";
import { agentFactory } from "../services/agents/agent-factory";
import { orchestrator } from "./approvals";
import { toJsonString, fromJsonString } from "../utils/db-helpers";

export const aiAgentRoutes = new Elysia()
  // Agent configuration list
  .get("/agents", async () => {
    return await prisma.aIAgentConfig.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { executions: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  })

  // Create agent configuration
  .post(
    "/agents",
    async ({
      body,
    }: {
      body: {
        agentType: string;
        name: string;
        endpoint?: string;
        modelId?: string;
        capabilities?: any;
        isDefault?: boolean;
      };
    }) => {
      const { agentType, name, endpoint, modelId, capabilities, isDefault } =
        body;

      if (isDefault) {
        await prisma.aIAgentConfig.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      return await prisma.aIAgentConfig.create({
        data: {
          agentType,
          name,
          endpoint,
          modelId,
          capabilities: capabilities || {},
          isDefault: isDefault || false,
        },
      });
    },
  )

  // Update agent configuration
  .patch(
    "/agents/:id",
    async ({
      params,
      body,
    }: {
      params: { id: string };
      body: {
        name?: string;
        endpoint?: string;
        modelId?: string;
        capabilities?: any;
        isDefault?: boolean;
        isActive?: boolean;
      };
    }) => {
      const { id } = params;
      const { name, endpoint, modelId, capabilities, isDefault, isActive } = body;

      if (isDefault) {
        await prisma.aIAgentConfig.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      return await prisma.aIAgentConfig.update({
        where: { id: parseInt(id) },
        data: {
          ...(name && { name }),
          ...(endpoint !== undefined && { endpoint }),
          ...(modelId !== undefined && { modelId }),
          ...(capabilities && { capabilities }),
          ...(isDefault !== undefined && { isDefault }),
          ...(isActive !== undefined && { isActive }),
        },
      });
    },
  )

  // Delete agent configuration
  .delete("/agents/:id", async ({ params }: { params: { id: string } }) => {
    const { id } = params;
    return await prisma.aIAgentConfig.update({
      where: { id: parseInt(id) },
      data: { isActive: false },
    });
  })

  // Available agent types
  .get("/agents/types", async () => {
    const registered = agentFactory.getRegisteredAgents();
    const available = await agentFactory.getAvailableAgents();
    return {
      registered,
      available: available.map((a) => a.type),
    };
  })

  // Execute agent on task
  .post(
    "/tasks/:id/execute",
    async ({
      params,
      body,
      set,
    }: {
      params: { id: string };
      body: {
        agentConfigId?: number;
        workingDirectory?: string;
        timeout?: number;
        instruction?: string;
        branchName?: string;
        useTaskAnalysis?: boolean;
        optimizedPrompt?: string;
      };
      set: any;
    }) => {
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
      } = body;

      const task = await prisma.task.findUnique({
        where: { id: taskIdNum },
        include: {
          developerModeConfig: true,
          theme: true,
        },
      });

      if (!task) {
        set.status = 404;
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

      const session = await prisma.agentSession.create({
        data: {
          configId: developerModeConfig.id,
          status: "pending",
        },
      });

      if (branchName) {
        const branchCreated = await orchestrator.createBranch(
          workDir,
          branchName,
        );
        if (!branchCreated) {
          return { error: "Failed to create branch", branchName };
        }
      }

      await prisma.notification.create({
        data: {
          type: "agent_execution_started",
          title: "エージェント実行開始",
          message: `「${task.title}」の自動実行を開始しました`,
          link: `/tasks/${taskIdNum}`,
          metadata: toJsonString({ sessionId: session.id, taskId: taskIdNum }),
        },
      });

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
            const analysisOutput = fromJsonString<any>(
              latestAnalysisAction.output,
            );
            if (analysisOutput?.summary && analysisOutput?.suggestedSubtasks) {
              analysisInfo = {
                summary: analysisOutput.summary,
                complexity: analysisOutput.complexity || "medium",
                estimatedTotalHours: analysisOutput.estimatedTotalHours || 0,
                subtasks: (analysisOutput.suggestedSubtasks || []).map(
                  (st: any) => ({
                    title: st.title,
                    description: st.description || "",
                    estimatedHours: st.estimatedHours || 0,
                    priority: st.priority || "medium",
                    order: st.order || 0,
                    dependencies: st.dependencies,
                  }),
                ),
                reasoning: analysisOutput.reasoning || "",
                tips: analysisOutput.tips,
              };
              console.log(`[API] Using AI task analysis for task ${taskIdNum}`);
              console.log(
                `[API] Analysis subtasks count: ${analysisInfo.subtasks.length}`,
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
          if (result.success) {
            const diff = await orchestrator.getFullGitDiff(workDir);
            const structuredDiff = await orchestrator.getDiff(workDir);

            if (diff && diff !== "No changes detected") {
              const implementationSummary =
                result.output || "実装が完了しました。";

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
                    diff,
                    structuredDiff,
                    implementationSummary,
                    executionTimeMs: result.executionTimeMs,
                  }),
                  executionType: "code_review",
                  estimatedChanges: toJsonString({
                    diff,
                    filesChanged: structuredDiff.length,
                    summary: implementationSummary.substring(0, 500),
                  }),
                  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                },
              });

              await prisma.notification.create({
                data: {
                  type: "pr_review_requested",
                  title: "コードレビュー依頼",
                  message: `「${task.title}」の実装が完了しました。レビューをお願いします。`,
                  link: `/approvals/${approvalRequest.id}`,
                  metadata: toJsonString({
                    approvalRequestId: approvalRequest.id,
                    sessionId: session.id,
                    taskId: taskIdNum,
                  }),
                },
              });
            } else {
              await prisma.notification.create({
                data: {
                  type: "agent_execution_complete",
                  title: "エージェント実行完了（変更なし）",
                  message: `「${task.title}」の実行が完了しましたが、コード変更はありませんでした。`,
                  link: `/tasks/${taskIdNum}`,
                  metadata: toJsonString({
                    sessionId: session.id,
                    taskId: taskIdNum,
                  }),
                },
              });
            }
          } else {
            await prisma.notification.create({
              data: {
                type: "agent_error",
                title: "エージェント実行失敗",
                message: `「${task.title}」の自動実行が失敗しました: ${result.errorMessage}`,
                link: `/tasks/${taskIdNum}`,
                metadata: toJsonString({
                  sessionId: session.id,
                  taskId: taskIdNum,
                }),
              },
            });
          }
        })
        .catch(async (error) => {
          console.error("Agent execution error:", error);
          await prisma.notification.create({
            data: {
              type: "agent_error",
              title: "エージェント実行エラー",
              message: `「${task.title}」の実行中にエラーが発生しました`,
              link: `/tasks/${taskIdNum}`,
            },
          });
        });

      return {
        success: true,
        sessionId: session.id,
        taskId: taskIdNum,
        workingDirectory: workDir,
        message:
          "エージェント実行を開始しました。リアルタイムで進捗を確認できます。",
      };
    },
  )

  // Claude CLI diagnosis endpoint
  .get("/agents/diagnose", async () => {
    const { spawn } = await import("child_process");
    const claudePath = process.env.CLAUDE_CODE_PATH || "claude";

    console.log("[Diagnose] Testing Claude CLI...");
    console.log("[Diagnose] Claude path:", claudePath);
    console.log("[Diagnose] Platform:", process.platform);

    const results: {
      step: string;
      success: boolean;
      output?: string;
      error?: string;
      duration?: number;
    }[] = [];

    // Step 1: Test claude --version
    const versionResult = await new Promise<{
      success: boolean;
      output?: string;
      error?: string;
      duration: number;
    }>((resolve) => {
      const startTime = Date.now();
      const proc = spawn(claudePath, ["--version"], { shell: true });
      let stdout = "";
      let stderr = "";

      const timeout = setTimeout(() => {
        proc.kill();
        resolve({
          success: false,
          error: "Timeout (10s)",
          duration: Date.now() - startTime,
        });
      }, 10000);

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });
      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        clearTimeout(timeout);
        resolve({
          success: code === 0,
          output: stdout.trim(),
          error: stderr.trim() || (code !== 0 ? `Exit code: ${code}` : undefined),
          duration: Date.now() - startTime,
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          error: err.message,
          duration: Date.now() - startTime,
        });
      });
    });

    results.push({ step: "claude --version", ...versionResult });
    console.log("[Diagnose] Version check:", versionResult);

    // Step 2: Test simple prompt with spawn and explicit cmd.exe
    if (versionResult.success) {
      const promptResult = await new Promise<{
        success: boolean;
        output?: string;
        error?: string;
        duration: number;
      }>((resolve) => {
        const startTime = Date.now();

        const isWindows = process.platform === "win32";
        let proc;

        if (isWindows) {
          const fullCommand = `${claudePath} --dangerously-skip-permissions -p "Say hello"`;
          console.log("[Diagnose] Windows full command:", fullCommand);
          proc = spawn("cmd.exe", ["/c", fullCommand], {
            env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
            windowsHide: true,
          });
        } else {
          proc = spawn(
            claudePath,
            ["--dangerously-skip-permissions", "-p", "Say hello"],
            {
              env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
            },
          );
        }

        let stdout = "";
        let stderr = "";

        const timeout = setTimeout(() => {
          console.log("[Diagnose] Timeout, killing process");
          proc.kill();
          resolve({
            success: false,
            error: "Timeout (90s)",
            duration: Date.now() - startTime,
          });
        }, 90000);

        proc.stdout?.on("data", (data) => {
          const chunk = data.toString();
          stdout += chunk;
          console.log("[Diagnose] stdout chunk:", chunk.substring(0, 100));
        });

        proc.stderr?.on("data", (data) => {
          const chunk = data.toString();
          stderr += chunk;
          console.log("[Diagnose] stderr chunk:", chunk.substring(0, 100));
        });

        proc.on("close", (code) => {
          clearTimeout(timeout);
          console.log(
            "[Diagnose] Process closed, code:",
            code,
            "stdout length:",
            stdout.length,
          );
          resolve({
            success: code === 0,
            output: stdout.substring(0, 500),
            error:
              stderr.trim() || (code !== 0 ? `Exit code: ${code}` : undefined),
            duration: Date.now() - startTime,
          });
        });

        proc.on("error", (err) => {
          clearTimeout(timeout);
          console.log("[Diagnose] Process error:", err.message);
          resolve({
            success: false,
            error: err.message,
            duration: Date.now() - startTime,
          });
        });
      });

      results.push({ step: "simple prompt test", ...promptResult });
      console.log("[Diagnose] Prompt test result:", promptResult);
    }

    return {
      claudePath,
      platform: process.platform,
      results,
      allPassed: results.every((r) => r.success),
    };
  })

  // Get task execution status
  .get(
    "/tasks/:id/execution-status",
    async ({ params }: { params: { id: string } }) => {
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

        const isWaitingForInput = latestExecution?.status === "waiting_for_input";
        const questionText = (latestExecution as any)?.question || null;
        let questionType: "tool_call" | "pattern_match" | "none" =
          ((latestExecution as any)?.questionType as
            | "tool_call"
            | "pattern_match"
            | "none") || "none";

        if (isWaitingForInput && questionText && questionType === "none") {
          questionType = "pattern_match";
        }

        return {
          sessionId: latestSession.id,
          sessionStatus: latestSession.status,
          executionId: latestExecution?.id,
          executionStatus: latestExecution?.status,
          output: latestExecution?.output,
          errorMessage: latestExecution?.errorMessage,
          startedAt: latestExecution?.startedAt,
          completedAt: latestExecution?.completedAt,
          waitingForInput: isWaitingForInput,
          question: questionText,
          questionType,
        };
      } catch (error) {
        console.error("[execution-status] Error fetching status:", error);
        return { status: "error", message: "状態の取得中にエラーが発生しました" };
      }
    },
  )

  // Respond to agent (answer question)
  .post(
    "/tasks/:id/agent-respond",
    async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { response: string };
    }) => {
      const taskId = parseInt(params.id);
      const { response } = body;

      if (!response?.trim()) {
        return { error: "Response is required" };
      }

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

      if (!latestExecution || latestExecution.status !== "waiting_for_input") {
        return {
          error: "No execution waiting for input",
          currentStatus: latestExecution?.status,
        };
      }

      const workingDirectory =
        config.task.theme?.workingDirectory || process.cwd();

      try {
        orchestrator
          .executeContinuation(latestExecution.id, response.trim(), {
            timeout: 900000,
          })
          .then(async (result) => {
            if (result.success && !result.waitingForInput) {
              const diff = await orchestrator.getFullGitDiff(workingDirectory);
              if (diff && diff !== "No changes detected") {
                const structuredDiff =
                  await orchestrator.getDiff(workingDirectory);
                const implementationSummary =
                  result.output || "実装が完了しました。";

                const approvalRequest = await prisma.approvalRequest.create({
                  data: {
                    configId: config.id,
                    requestType: "code_review",
                    title: `「${config.task.title}」のコードレビュー`,
                    description: implementationSummary,
                    proposedChanges: toJsonString({
                      taskId,
                      sessionId: session.id,
                      workingDirectory,
                      diff,
                      structuredDiff,
                      implementationSummary,
                      executionTimeMs: result.executionTimeMs,
                    }),
                    estimatedChanges: toJsonString({
                      diff,
                      filesChanged: structuredDiff.length,
                      summary: implementationSummary.substring(0, 500),
                    }),
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                  },
                });

                await prisma.notification.create({
                  data: {
                    type: "pr_review_requested",
                    title: "コードレビュー依頼",
                    message: `「${config.task.title}」の実装が完了しました。レビューをお願いします。`,
                    link: `/approvals/${approvalRequest.id}`,
                  },
                });
              }
            }
          })
          .catch(console.error);

        return {
          success: true,
          message: "Response sent successfully",
          executionId: latestExecution.id,
        };
      } catch (error: any) {
        console.error("Agent respond failed:", error);
        return { error: error.message || "Failed to send response" };
      }
    },
  )

  // Get session details
  .get(
    "/agents/sessions/:id",
    async ({ params }: { params: { id: string } }) => {
      return await prisma.agentSession.findUnique({
        where: { id: parseInt(params.id) },
        include: {
          agentActions: { orderBy: { createdAt: "desc" } },
          agentExecutions: {
            include: {
              agentConfig: true,
              gitCommits: true,
            },
            orderBy: { createdAt: "desc" },
          },
        },
      });
    },
  )

  // Stop session
  .post(
    "/agents/sessions/:id/stop",
    async ({ params }: { params: { id: string } }) => {
      const sessionId = parseInt(params.id);

      const executions = orchestrator.getSessionExecutions(sessionId);
      for (const execution of executions) {
        await orchestrator.stopExecution(execution.executionId);
      }

      await prisma.agentSession.update({
        where: { id: sessionId },
        data: {
          status: "failed",
          completedAt: new Date(),
          errorMessage: "Manually stopped",
        },
      });

      return { success: true };
    },
  )

  // Stop task execution (rollback changes)
  .post(
    "/tasks/:id/stop-execution",
    async ({ params }: { params: { id: string } }) => {
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
          try {
            await orchestrator.stopExecution(runningExecution.id);
          } catch (e) {
            await prisma.agentExecution.update({
              where: { id: runningExecution.id },
              data: {
                status: "cancelled",
                completedAt: new Date(),
                errorMessage: "Cancelled by user",
              },
            });
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
        message: "Execution cancelled and changes reverted",
      };
    },
  );
