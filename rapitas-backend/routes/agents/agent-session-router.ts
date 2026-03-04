import { Elysia } from "elysia";
import { prisma } from "../../config/database";
import { orchestrator } from "./approvals";
import type { AgentExecutionWithExtras } from "../../types/agent-execution-types";

/**
 * エージェントセッション管理ルーター
 * セッション詳細取得、停止、再開可能実行の管理を担当
 */
export const agentSessionRouter = new Elysia({ prefix: '/agents' })

  // Get session details
  .get("/sessions/:id", async (context) => {
    const { params } = context;
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
  })

  // Stop session
  .post("/sessions/:id/stop", async (context) => {
    const { params } = context;
    const sessionId = parseInt(params.id);

    // オーケストレーターで停止を試みる
    const executions = orchestrator.getSessionExecutions(sessionId);
    for (const execution of executions) {
      await orchestrator.stopExecution(execution.executionId).catch(() => {});
    }

    // DBで実行中/待機中の実行をすべてキャンセル
    await prisma.agentExecution.updateMany({
      where: {
        sessionId,
        status: { in: ["running", "pending", "waiting_for_input"] },
      },
      data: {
        status: "cancelled",
        completedAt: new Date(),
        errorMessage: "Manually stopped",
      },
    });

    await prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorMessage: "Manually stopped",
      },
    });

    return { success: true };
  })

  // Get resumable executions (interrupted or stale running)
  // This handles both intentionally interrupted executions and ones left in "running" state after server restart
  .get("/resumable-executions", async () => {
    try {
      // Stale execution recovery is handled at startup by orchestrator.recoverStaleExecutions()
      // This endpoint only reads data — no recovery logic here to avoid race conditions
      // with newly created executions that haven't been added to activeExecutions yet.

      const currentActiveIds = orchestrator
        .getActiveExecutions()
        .map((e) => e.executionId);

      const resumableExecutions = await prisma.agentExecution.findMany({
        where: {
          OR: [
            // 中断された実行（再開可能）
            { status: "interrupted" },
            // 実際にメモリ上でアクティブな実行のみ
            {
              status: { in: ["running", "waiting_for_input"] },
              id: { in: currentActiveIds.length > 0 ? currentActiveIds : [-1] },
            },
          ],
        },
        include: {
          session: {
            include: {
              config: {
                include: {
                  task: {
                    select: {
                      id: true,
                      title: true,
                      theme: {
                        select: {
                          workingDirectory: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      return resumableExecutions.map(
        (exec: (typeof resumableExecutions)[number]) => {
          const execWithExtras = exec as typeof exec & AgentExecutionWithExtras;
          return {
            id: exec.id,
            taskId: exec.session.config?.task?.id,
            taskTitle: exec.session.config?.task?.title,
            sessionId: exec.sessionId,
            status: exec.status,
            claudeSessionId: execWithExtras.claudeSessionId,
            errorMessage: exec.errorMessage,
            output: exec.output?.slice(-500), // 最後の500文字のみ
            startedAt: exec.startedAt,
            completedAt: exec.completedAt,
            createdAt: exec.createdAt,
            workingDirectory:
              exec.session.config?.task?.theme?.workingDirectory,
            canResume: exec.status === "interrupted", // Only interrupted can be resumed
          };
        },
      );
    } catch (error) {
      const errObj = error as { code?: string; message?: string };
      if (errObj?.code === "P1001") {
        console.warn("[resumable-executions] Database unreachable, skipping");
      } else {
        console.error(
          "[resumable-executions] Error:",
          error instanceof Error ? error.message : String(error),
        );
      }
      return [];
    }
  })

  // Legacy endpoint for backwards compatibility
  .get("/interrupted-executions", async () => {
    try {
      const interruptedExecutions = await prisma.agentExecution.findMany({
        where: {
          status: "interrupted",
        },
        include: {
          session: {
            include: {
              config: {
                include: {
                  task: {
                    select: {
                      id: true,
                      title: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      return interruptedExecutions.map(
        (exec: (typeof interruptedExecutions)[number]) => {
          const execWithExtras = exec as typeof exec & AgentExecutionWithExtras;
          return {
            id: exec.id,
            taskId: exec.session.config?.task?.id,
            taskTitle: exec.session.config?.task?.title,
            sessionId: exec.sessionId,
            status: exec.status,
            claudeSessionId: execWithExtras.claudeSessionId,
            errorMessage: exec.errorMessage,
            output: exec.output?.slice(-500), // 最後の500文字のみ
            startedAt: exec.startedAt,
            completedAt: exec.completedAt,
            createdAt: exec.createdAt,
            canResume: !!execWithExtras.claudeSessionId, // Claude Session IDがあれば再開可能
          };
        },
      );
    } catch (error) {
      console.error("[interrupted-executions] Error:", error);
      return [];
    }
  });