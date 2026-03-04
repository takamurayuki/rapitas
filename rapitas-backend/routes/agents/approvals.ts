/**
 * Approvals API Routes
 * Task execution approval, code review, and subtask creation workflows
 */
import { Elysia, t } from "elysia";
import { prisma } from "../../config/database";
import { createOrchestrator } from "../../services/agents/agent-orchestrator";
import { GitHubService } from "../../services/github-service";
import { realtimeService } from "../../services/realtime-service";
import { toJsonString, fromJsonString } from "../../utils/db-helpers";
import type { SubtaskProposal } from "../../services/claude-agent";
import {
  captureScreenshotsForDiff,
  type ScreenshotResult,
} from "../../services/screenshot-service";

// Create service instances
const orchestrator = createOrchestrator(prisma);
const githubService = new GitHubService(prisma);

// Forward orchestrator events to realtime service
orchestrator.addEventListener((event) => {
  const executionChannel = `execution:${event.executionId}`;
  const sessionChannel = `session:${event.sessionId}`;

  const broadcastToBoth = (
    eventType: string,
    data: Record<string, unknown>,
  ) => {
    realtimeService.broadcast(executionChannel, eventType, data);
    realtimeService.broadcast(sessionChannel, eventType, data);
  };

  switch (event.type) {
    case "execution_started":
      broadcastToBoth("execution_started", {
        executionId: event.executionId,
        sessionId: event.sessionId,
        taskId: event.taskId,
        timestamp: event.timestamp.toISOString(),
      });
      break;
    case "execution_output":
      const outputData = event.data as { output: string; isError: boolean };
      realtimeService.broadcast(executionChannel, "execution_output", {
        executionId: event.executionId,
        output: outputData.output,
        isError: outputData.isError,
        timestamp: new Date().toISOString(),
      });
      realtimeService.broadcast(sessionChannel, "execution_output", {
        executionId: event.executionId,
        output: outputData.output,
        isError: outputData.isError,
        timestamp: new Date().toISOString(),
      });
      break;
    case "execution_completed":
      broadcastToBoth("execution_completed", {
        executionId: event.executionId,
        sessionId: event.sessionId,
        taskId: event.taskId,
        result: event.data,
        timestamp: event.timestamp.toISOString(),
      });
      break;
    case "execution_failed":
      broadcastToBoth("execution_failed", {
        executionId: event.executionId,
        sessionId: event.sessionId,
        taskId: event.taskId,
        error: event.data,
        timestamp: event.timestamp.toISOString(),
      });
      break;
    case "execution_cancelled":
      broadcastToBoth("execution_cancelled", {
        executionId: event.executionId,
        sessionId: event.sessionId,
        taskId: event.taskId,
        timestamp: event.timestamp.toISOString(),
      });
      break;
  }
});

// Export orchestrator for use in other modules
export { orchestrator };

// Prisma の String 型で保存された JSON フィールドをパースするヘルパー
interface ApprovalWithChanges {
  id: number;
  proposedChanges: string | Record<string, unknown> | null;
  estimatedChanges: string | Record<string, unknown> | null;
  [key: string]: unknown;
}

function parseApprovalJsonFields(approval: ApprovalWithChanges | null) {
  if (!approval) return approval;

  let proposedChanges = approval.proposedChanges;
  if (typeof proposedChanges === "string") {
    proposedChanges = fromJsonString(proposedChanges);
    if (proposedChanges === null) {
      console.error(
        `[approvals] Failed to parse proposedChanges for approval ${approval.id}`,
      );
      proposedChanges = {};
    }
  }

  // proposedChanges から diff（プレーンテキスト）を除外してレスポンスサイズを削減
  // structuredDiff はフロントのDiffViewerで使用されるため残す
  // diff は /approvals/:id/diff エンドポイントで別途取得可能
  const parsedChanges = (proposedChanges || {}) as Record<string, unknown>;
  const { diff: _diff, ...proposedChangesWithoutDiff } = parsedChanges;

  let estimatedChanges = typeof approval.estimatedChanges === "string"
    ? fromJsonString(approval.estimatedChanges)
    : approval.estimatedChanges;
  // estimatedChanges からも diff を除外
  if (estimatedChanges && typeof estimatedChanges === "object" && "diff" in estimatedChanges) {
    const { diff: _estDiff, ...estWithoutDiff } = estimatedChanges as Record<string, unknown>;
    estimatedChanges = estWithoutDiff;
  }

  const parsed = {
    ...approval,
    proposedChanges: proposedChangesWithoutDiff,
    estimatedChanges,
  };

  // スクリーンショットのデバッグログ
  const screenshots = parsed.proposedChanges?.screenshots as Array<{ url: string }> | undefined;
  if (screenshots && screenshots.length > 0) {
    console.log(
      `[approvals] Approval ${approval.id} has ${screenshots.length} screenshot(s): ${screenshots.map((s) => s.url).join(", ")}`,
    );
  } else {
    console.log(
      `[approvals] Approval ${approval.id} has no screenshots. Keys: ${Object.keys(parsed.proposedChanges || {}).join(", ")}`,
    );
  }
  return parsed;
}

export const approvalsRoutes = new Elysia({ prefix: "/approvals" })
  // Get approval list
  .get("/", async (context) => {
      const { query  } = context;
    const { status  } = query as { status?: string };
    const approvals = await prisma.approvalRequest.findMany({
      where: status ? { status } : { status: "pending" },
      include: {
        config: {
          include: {
            task: {
              include: {
                theme: {
                  select: {
                    defaultBranch: true,
                    workingDirectory: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return approvals.map(parseApprovalJsonFields);
  })

  // Get approval details
  .get("/:id", async (context) => {
      const { params  } = context;
    const { id  } = params as { id: string };
    const approval = await prisma.approvalRequest.findUnique({
      where: { id: parseInt(id) },
      include: {
        config: {
          include: {
            task: {
              include: {
                theme: {
                  select: {
                    defaultBranch: true,
                    workingDirectory: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    return parseApprovalJsonFields(approval);
  })

  // Approve request
  .post(
    "/:id/approve",
    async (context) => {
      const params = context.params as { id: string };
      const body = context.body as { selectedSubtasks?: number[] };
      const approvalId = parseInt(params.id);
      const { selectedSubtasks } = body;

      const approval = await prisma.approvalRequest.findUnique({
        where: { id: approvalId },
        include: {
          config: {
            include: { task: true },
          },
        },
      });

      if (!approval) {
        return { error: "Approval request not found" };
      }

      if (approval.status !== "pending") {
        return { error: "Approval request is not pending" };
      }

      // Update approval request
      await prisma.approvalRequest.update({
        where: { id: approvalId },
        data: {
          status: "approved",
          approvedAt: new Date(),
        },
      });

      // Handle by request type
      if (approval.requestType === "task_execution") {
        const proposedChanges = fromJsonString<{
          taskId: number;
          agentConfigId?: number;
          workingDirectory?: string;
        }>(approval.proposedChanges);

        if (!proposedChanges) {
          return { error: "Invalid proposed changes data" };
        }

        const task = approval.config.task;

        // Create session
        const session = await prisma.agentSession.create({
          data: {
            configId: approval.config.id,
            status: "pending",
          },
        });

        // Create notification
        await prisma.notification.create({
          data: {
            type: "agent_execution_started",
            title: "エージェント実行開始",
            message: `承認されたタスク「${task.title}」の自動実行を開始しました`,
            link: `/tasks/${task.id}`,
            metadata: toJsonString({ sessionId: session.id, taskId: task.id }),
          },
        });

        // Start agent execution asynchronously
        orchestrator
          .executeTask(
            {
              id: task.id,
              title: task.title,
              description: task.description,
              context: task.executionInstructions || undefined,
              workingDirectory: proposedChanges.workingDirectory,
            },
            {
              taskId: task.id,
              sessionId: session.id,
              agentConfigId: proposedChanges.agentConfigId,
              workingDirectory: proposedChanges.workingDirectory,
            },
          )
          .then(async (result) => {
            await prisma.notification.create({
              data: {
                type: "agent_execution_complete",
                title: result.success
                  ? "エージェント実行完了"
                  : "エージェント実行失敗",
                message: result.success
                  ? `「${task.title}」の自動実行が完了しました`
                  : `「${task.title}」の自動実行が失敗しました: ${result.errorMessage}`,
                link: `/tasks/${task.id}`,
                metadata: toJsonString({
                  sessionId: session.id,
                  taskId: task.id,
                  success: result.success,
                }),
              },
            });

            if (result.success) {
              await prisma.task.update({
                where: { id: task.id },
                data: { status: "done", completedAt: new Date() },
              });
            }
          })
          .catch(async (error) => {
            console.error("Agent execution failed:", error);
            await prisma.notification.create({
              data: {
                type: "agent_error",
                title: "エージェント実行エラー",
                message: `「${task.title}」の実行中にエラーが発生しました`,
                link: `/tasks/${task.id}`,
              },
            });
          });

        return {
          success: true,
          sessionId: session.id,
          autoExecutionStarted: true,
        };
      } else if (approval.requestType === "code_review") {
        const proposedChanges = fromJsonString<{
          taskId: number;
          sessionId: number;
          workingDirectory: string;
          branchName?: string;
          diff: string;
        }>(approval.proposedChanges);

        if (!proposedChanges) {
          return { error: "Invalid proposed changes data" };
        }

        const task = approval.config.task;
        const workDir = proposedChanges.workingDirectory;

        const commitMessage = `feat: ${task.title}`;

        const commitResult = await orchestrator.commitChanges(
          workDir,
          commitMessage,
          task.title,
        );

        if (!commitResult.success) {
          await prisma.notification.create({
            data: {
              type: "agent_error",
              title: "コミット失敗",
              message: `「${task.title}」のコミットに失敗しました: ${commitResult.error}`,
              link: `/tasks/${task.id}`,
            },
          });
          return { success: false, error: commitResult.error };
        }

        const prBody = `## 概要
${task.description || task.title}

## 変更内容
Claude Codeによる自動実装

## 関連タスク
Task ID: ${task.id}

---
🤖 Generated by rapitas AI Development Mode`;

        const prResult = await orchestrator.createPullRequest(
          workDir,
          task.title,
          prBody,
          "main",
        );

        if (prResult.success) {
          if (prResult.prNumber) {
            await prisma.task.update({
              where: { id: task.id },
              data: { status: "in_review" },
            });
          }

          await prisma.notification.create({
            data: {
              type: "pr_approved",
              title: "PR作成完了",
              message: `「${task.title}」のPRが作成されました`,
              link: prResult.prUrl || `/tasks/${task.id}`,
              metadata: toJsonString({
                taskId: task.id,
                commitHash: commitResult.commitHash,
                prUrl: prResult.prUrl,
                prNumber: prResult.prNumber,
              }),
            },
          });

          return {
            success: true,
            commitHash: commitResult.commitHash,
            prUrl: prResult.prUrl,
            prNumber: prResult.prNumber,
          };
        } else {
          await prisma.notification.create({
            data: {
              type: "agent_error",
              title: "PR作成失敗",
              message: `「${task.title}」のPR作成に失敗しました: ${prResult.error}`,
              link: `/tasks/${task.id}`,
              metadata: toJsonString({ commitHash: commitResult.commitHash }),
            },
          });

          return {
            success: false,
            commitHash: commitResult.commitHash,
            error: prResult.error,
          };
        }
      } else if (approval.requestType === "subtask_creation") {
        const proposedChanges = fromJsonString<{
          subtasks: SubtaskProposal[];
        }>(approval.proposedChanges);

        if (!proposedChanges) {
          return { error: "Invalid proposed changes data" };
        }

        const subtasksToCreate = selectedSubtasks
          ? proposedChanges.subtasks.filter((_, i) =>
              selectedSubtasks.includes(i),
            )
          : proposedChanges.subtasks;

        // トランザクションで重複チェックと作成を原子的に実行
        const createdSubtasks = await prisma.$transaction(async (tx: typeof prisma) => {
          // トランザクション内で既存サブタスクを取得
          const existingSubtasks = await tx.task.findMany({
            where: { parentId: approval.config.taskId },
            select: { title: true },
          });
          const existingTitles = new Set(existingSubtasks.map((st: { title: string }) => st.title.toLowerCase().trim()));

          const created = [];
          for (const subtask of subtasksToCreate) {
            // タイトルが重複する場合はスキップ
            const normalizedTitle = subtask.title.toLowerCase().trim();
            if (existingTitles.has(normalizedTitle)) {
              console.log(`[approvals] Skipping duplicate subtask: ${subtask.title}`);
              continue;
            }
            existingTitles.add(normalizedTitle);

            const newSubtask = await tx.task.create({
              data: {
                title: subtask.title,
                description: subtask.description,
                priority: subtask.priority,
                estimatedHours: subtask.estimatedHours,
                parentId: approval.config.taskId,
                agentGenerated: true,
              },
            });
            created.push(newSubtask);
          }
          return created;
        }, {
          isolationLevel: 'Serializable', // 競合を防ぐための分離レベル
        });

        await prisma.notification.create({
          data: {
            type: "task_completed",
            title: "サブタスク作成完了",
            message: `「${approval.config.task.title}」に${createdSubtasks.length}個のサブタスクが作成されました`,
            link: `/tasks/${approval.config.taskId}`,
          },
        });

        return { success: true, createdSubtasks };
      }

      // Other request types
      await prisma.notification.create({
        data: {
          type: "approval_request",
          title: "承認完了",
          message: `リクエストが承認されました`,
          link: `/tasks/${approval.config.taskId}`,
        },
      });

      return { success: true };
    },
  )

  // Reject request
  .post(
    "/:id/reject",
    async (context) => {
      const params = context.params as { id: string };
      const body = context.body as { reason?: string };
      const { id  } = params;
      const { reason  } = body;

      const approval = await prisma.approvalRequest.findUnique({
        where: { id: parseInt(id) },
        include: {
          config: {
            include: { task: true },
          },
        },
      });

      if (!approval) {
        return { error: "Approval request not found" };
      }

      await prisma.approvalRequest.update({
        where: { id: parseInt(id) },
        data: {
          status: "rejected",
          rejectedAt: new Date(),
          rejectionReason: reason,
        },
      });

      if (approval.requestType === "code_review") {
        const proposedChanges = fromJsonString<{
          workingDirectory: string;
        }>(approval.proposedChanges);

        if (!proposedChanges) {
          return { error: "Invalid proposed changes data" };
        }

        const reverted = await orchestrator.revertChanges(
          proposedChanges.workingDirectory,
        );

        await prisma.notification.create({
          data: {
            type: "pr_changes_requested",
            title: "コードレビュー却下",
            message: `「${approval.config.task.title}」のコードレビューが却下されました${reason ? `: ${reason}` : ""}。変更は元に戻されました。`,
            link: `/tasks/${approval.config.taskId}`,
          },
        });

        return { success: true, reverted };
      }

      return { success: true };
    },
  )

  // Approve code review (commit + create PR)
  .post(
    "/:id/approve-code-review",
    async (context) => {
      const params = context.params as { id: string };
      const body = context.body as { commitMessage: string; baseBranch?: string };
      const { id } = params;
      const { commitMessage, baseBranch = "main" } = body;

      const approval = await prisma.approvalRequest.findUnique({
        where: { id: parseInt(id) },
        include: {
          config: {
            include: { task: { include: { theme: true } } },
          },
        },
      });

      if (!approval) {
        return { error: "Approval request not found" };
      }

      if (approval.status !== "pending") {
        return { error: "Approval request is not pending" };
      }

      if (approval.requestType !== "code_review") {
        return { error: "This endpoint is only for code_review requests" };
      }

      const proposedChanges = fromJsonString<{
        workingDirectory?: string;
        files?: string[];
      }>(approval.proposedChanges);

      const workingDirectory =
        proposedChanges?.workingDirectory ||
        approval.config.task?.theme?.workingDirectory;

      if (!workingDirectory) {
        return { error: "Working directory not found" };
      }

      try {
        const commitResult = await orchestrator.createCommit(
          workingDirectory,
          commitMessage,
        );

        const prResult = await githubService.createPullRequest(
          workingDirectory,
          commitResult.branch,
          baseBranch,
          `[Task-${approval.config.taskId}] ${commitMessage}`,
          `## 概要\n\n${approval.description || "AIエージェントによる自動実装"}\n\n関連タスク: #${approval.config.taskId}`,
        );

        await prisma.approvalRequest.update({
          where: { id: parseInt(id) },
          data: {
            status: "approved",
            approvedAt: new Date(),
          },
        });

        if (prResult.prNumber) {
          await prisma.task.update({
            where: { id: approval.config.taskId },
            data: { githubPrId: prResult.prNumber },
          });
        }

        await prisma.notification.create({
          data: {
            type: "pr_approved",
            title: "PR作成完了",
            message: `「${approval.config.task.title}」のPRを作成しました`,
            link: prResult.prUrl || `/tasks/${approval.config.taskId}`,
            metadata: toJsonString({
              prNumber: prResult.prNumber,
              prUrl: prResult.prUrl,
              commitHash: commitResult.hash,
            }),
          },
        });

        return {
          success: true,
          commit: commitResult,
          pr: prResult,
        };
      } catch (error) {
        console.error("Code review approval failed:", error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  )

  // Reject code review (discard changes)
  .post(
    "/:id/reject-code-review",
    async (context) => {
      const { id } = context.params as { id: string };
      const { reason } = context.body as { reason?: string };

      const approval = await prisma.approvalRequest.findUnique({
        where: { id: parseInt(id) },
        include: {
          config: {
            include: { task: { include: { theme: true } } },
          },
        },
      });

      if (!approval) {
        return { error: "Approval request not found" };
      }

      if (approval.requestType !== "code_review") {
        return { error: "This endpoint is only for code_review requests" };
      }

      const proposedChanges = fromJsonString<{
        workingDirectory?: string;
      }>(approval.proposedChanges);

      const workingDirectory =
        proposedChanges?.workingDirectory ||
        approval.config.task?.theme?.workingDirectory;

      if (!workingDirectory) {
        return { error: "Working directory not found" };
      }

      try {
        const reverted = await orchestrator.revertChanges(workingDirectory);

        await prisma.approvalRequest.update({
          where: { id: parseInt(id) },
          data: {
            status: "rejected",
            rejectedAt: new Date(),
            rejectionReason: reason,
          },
        });

        await prisma.notification.create({
          data: {
            type: "pr_changes_requested",
            title: "コードレビュー却下",
            message: `「${approval.config.task.title}」の変更を破棄しました${reason ? `: ${reason}` : ""}`,
            link: `/tasks/${approval.config.taskId}`,
          },
        });

        return { success: true, reverted };
      } catch (error) {
        console.error("Code review rejection failed:", error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  )

  // Request changes (send feedback and re-execute)
  .post(
    "/:id/request-changes",
    async (context) => {
      const params = context.params as { id: string };
      const body = context.body as {
        feedback: string;
        comments: { file?: string; content: string; type: string }[];
      };
      const { id } = params;
      const { feedback, comments } = body;

      const approval = await prisma.approvalRequest.findUnique({
        where: { id: parseInt(id) },
        include: {
          config: {
            include: { task: { include: { theme: true } } },
          },
        },
      });

      if (!approval) {
        return { error: "Approval request not found" };
      }

      if (approval.requestType !== "code_review") {
        return { error: "This endpoint is only for code_review requests" };
      }

      const proposedChanges = fromJsonString<{
        workingDirectory?: string;
        sessionId?: number;
        implementationSummary?: string;
      }>(approval.proposedChanges);

      const workingDirectory =
        proposedChanges?.workingDirectory ||
        approval.config.task?.theme?.workingDirectory;

      if (!workingDirectory) {
        return { error: "Working directory not found" };
      }

      const task = approval.config.task;
      if (!task) {
        return { error: "Task not found" };
      }

      try {
        // Revert changes
        await orchestrator.revertChanges(workingDirectory);

        // Build feedback instructions
        const feedbackInstructions = [];

        if (feedback) {
          feedbackInstructions.push(`## 全体的なフィードバック\n${feedback}`);
        }

        if (comments && comments.length > 0) {
          feedbackInstructions.push("\n## 具体的な修正依頼:");
          comments.forEach((comment, index) => {
            const typeLabel =
              comment.type === "change_request"
                ? "修正"
                : comment.type === "question"
                  ? "質問"
                  : "コメント";
            const fileInfo = comment.file ? ` (${comment.file})` : "";
            feedbackInstructions.push(
              `${index + 1}. [${typeLabel}]${fileInfo}: ${comment.content}`,
            );
          });
        }

        const additionalInstructions = feedbackInstructions.join("\n");

        const previousImplementation = proposedChanges?.implementationSummary
          ? `\n\n## 前回の実装内容（参考）:\n${proposedChanges.implementationSummary.substring(0, 1000)}`
          : "";

        const fullInstruction = `
以下のタスクを実装してください。前回の実装に対してフィードバックがありますので、それを踏まえて修正・改善してください。

## タスク
${task.title}
${task.description || ""}

${additionalInstructions}
${previousImplementation}

上記のフィードバックを反映した実装をお願いします。
`;

        // Update approval status
        await prisma.approvalRequest.update({
          where: { id: parseInt(id) },
          data: {
            status: "rejected",
            rejectedAt: new Date(),
            rejectionReason:
              "修正依頼: " +
              (feedback || comments.map((c) => c.content).join(", ")).substring(
                0,
                200,
              ),
          },
        });

        // Create new session for re-execution
        const session = await prisma.agentSession.create({
          data: {
            configId: approval.configId,
            status: "pending",
            metadata: toJsonString({
              previousApprovalId: parseInt(id),
              feedbackIteration: true,
            }),
          },
        });

        const agentConfig = await prisma.aIAgentConfig.findFirst({
          where: { isDefault: true, isActive: true },
        });

        const timeout = 900000; // 15 minutes

        // Execute agent asynchronously
        orchestrator
          .executeTask(
            {
              id: task.id,
              title: task.title,
              description: fullInstruction,
              context: task.executionInstructions || undefined,
              workingDirectory,
            },
            {
              taskId: task.id,
              sessionId: session.id,
              agentConfigId: agentConfig?.id,
              workingDirectory,
              timeout,
            },
          )
          .then(async (result) => {
            if (result.success) {
              const diff = await orchestrator.getFullGitDiff(workingDirectory);
              const structuredDiff =
                await orchestrator.getDiff(workingDirectory);

              if (diff && diff !== "No changes detected") {
                const implementationSummary =
                  result.output || "修正が完了しました。";

                // UI変更がある場合はスクリーンショットを撮影
                let screenshots: ScreenshotResult[] = [];
                try {
                  screenshots = await captureScreenshotsForDiff(structuredDiff, {
                    workingDirectory,
                    agentOutput: result.output || "",
                  });
                  if (screenshots.length > 0) {
                    console.log(`[approvals] Captured ${screenshots.length} screenshots for task ${task.id}: ${screenshots.map((s) => s.page).join(", ")}`);
                  }
                } catch (screenshotErr) {
                  console.warn("[approvals] Screenshot capture failed (non-fatal):", screenshotErr);
                }

                // path（ファイルシステムパス）を除外してフロントに安全なデータのみ保存
                const screenshotData = screenshots.map(({ path, ...rest }) => rest);
                const newApprovalRequest = await prisma.approvalRequest.create({
                  data: {
                    configId: approval.configId,
                    requestType: "code_review",
                    title: `「${task.title}」のコードレビュー（修正版）`,
                    description: implementationSummary,
                    proposedChanges: toJsonString({
                      taskId: task.id,
                      sessionId: session.id,
                      workingDirectory,
                      structuredDiff,
                      implementationSummary,
                      executionTimeMs: result.executionTimeMs,
                      feedbackIteration: true,
                      previousFeedback: feedback,
                      previousComments: comments,
                      screenshots: screenshotData,
                    }),
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
                    title: "修正版レビュー依頼",
                    message: `「${task.title}」の修正が完了しました。再度レビューをお願いします。`,
                    link: `/approvals/${newApprovalRequest.id}`,
                  },
                });
              }
            }
          })
          .catch(console.error);

        return {
          success: true,
          message: "修正依頼を受け付けました。再実行を開始します。",
          sessionId: session.id,
        };
      } catch (error) {
        console.error("Request changes failed:", error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  )

  // Get diff
  .get("/:id/diff", async (context) => {
      const { params  } = context;
    const { id  } = params as { id: string };

    const approval = await prisma.approvalRequest.findUnique({
      where: { id: parseInt(id) },
      include: {
        config: {
          include: { task: { include: { theme: true } } },
        },
      },
    });

    if (!approval) {
      return { error: "Approval request not found" };
    }

    const proposedChanges = fromJsonString<{
      workingDirectory?: string;
    }>(approval.proposedChanges);

    const workingDirectory =
      proposedChanges?.workingDirectory ||
      approval.config.task?.theme?.workingDirectory;

    if (!workingDirectory) {
      return { error: "Working directory not found" };
    }

    try {
      const diff = await orchestrator.getDiff(workingDirectory);
      return { files: diff };
    } catch (error) {
      console.error("Failed to get diff:", error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  })

  // Bulk approve
  .post("/bulk-approve", async (context) => {
      const { body  } = context;
    const { ids  } = body as { ids: number[] };

    const results = [];
    for (const id of ids) {
      try {
        const approval = await prisma.approvalRequest.findUnique({
          where: { id },
          include: {
            config: {
              include: { task: true },
            },
          },
        });

        if (!approval || approval.status !== "pending") continue;

        await prisma.approvalRequest.update({
          where: { id },
          data: { status: "approved", approvedAt: new Date() },
        });

        if (approval.requestType === "task_execution") {
          const proposedChanges = fromJsonString<{
            taskId: number;
            agentConfigId?: number;
            workingDirectory?: string;
          }>(approval.proposedChanges);
          const task = approval.config.task;

          const session = await prisma.agentSession.create({
            data: {
              configId: approval.config.id,
              status: "pending",
            },
          });

          orchestrator
            .executeTask(
              {
                id: task.id,
                title: task.title,
                description: task.description,
                context: task.executionInstructions || undefined,
                workingDirectory: proposedChanges?.workingDirectory,
              },
              {
                taskId: task.id,
                sessionId: session.id,
                agentConfigId: proposedChanges?.agentConfigId,
                workingDirectory: proposedChanges?.workingDirectory,
              },
            )
            .then(async (result) => {
              await prisma.notification.create({
                data: {
                  type: result.success
                    ? "agent_execution_complete"
                    : "agent_error",
                  title: result.success
                    ? "エージェント実行完了"
                    : "エージェント実行失敗",
                  message: result.success
                    ? `「${task.title}」の自動実行が完了しました`
                    : `「${task.title}」の自動実行が失敗しました`,
                  link: `/tasks/${task.id}`,
                },
              });
              if (result.success) {
                await prisma.task.update({
                  where: { id: task.id },
                  data: { status: "done", completedAt: new Date() },
                });
              }
            })
            .catch(console.error);

          results.push({ id, success: true, autoExecutionStarted: true });
        } else if (approval.requestType === "subtask_creation") {
          const proposedChanges = fromJsonString<{
            subtasks: SubtaskProposal[];
          }>(approval.proposedChanges);

          // 既存のサブタスクを取得して重複チェック
          const existingSubtasks = await prisma.task.findMany({
            where: { parentId: approval.config.taskId },
            select: { title: true },
          });
          const existingTitles = new Set(existingSubtasks.map((st: { title: string }) => st.title.toLowerCase().trim()));

          for (const subtask of proposedChanges?.subtasks || []) {
            // タイトルが重複する場合はスキップ
            const normalizedTitle = subtask.title.toLowerCase().trim();
            if (existingTitles.has(normalizedTitle)) {
              console.log(`[approvals:bulk] Skipping duplicate subtask: ${subtask.title}`);
              continue;
            }
            existingTitles.add(normalizedTitle);

            await prisma.task.create({
              data: {
                title: subtask.title,
                description: subtask.description,
                priority: subtask.priority,
                estimatedHours: subtask.estimatedHours,
                parentId: approval.config.taskId,
                agentGenerated: true,
              },
            });
          }

          results.push({ id, success: true });
        } else {
          results.push({ id, success: true });
        }
      } catch (error) {
        results.push({ id, success: false });
      }
    }

    return { results };
  });
