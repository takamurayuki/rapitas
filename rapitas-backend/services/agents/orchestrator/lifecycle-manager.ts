/**
 * ライフサイクル管理
 * シグナルハンドラー、グレースフルシャットダウン、エージェント状態保存を担当
 */
import { createLogger } from "../../../config/logger";
import type {
  PrismaClientInstance,
  ActiveAgentInfo,
  ExecutionState,
  OrchestratorEvent,
  EventListener,
} from "./types";
import type { QuestionTimeoutManager } from "./question-timeout-manager";

const logger = createLogger("lifecycle-manager");

/**
 * ライフサイクル管理に必要なコンテキスト
 */
export type LifecycleContext = {
  prisma: PrismaClientInstance;
  activeAgents: Map<number, ActiveAgentInfo>;
  activeExecutions: Map<number, ExecutionState>;
  questionTimeoutManager: QuestionTimeoutManager;
  serverStopCallback: (() => Promise<void> | void) | null;
  getIsShuttingDown: () => boolean;
  setIsShuttingDown: (value: boolean) => void;
};

/**
 * 特定のエージェントの状態をDBに保存
 */
export async function saveAgentState(
  prisma: PrismaClientInstance,
  executionId: number,
  info: ActiveAgentInfo,
  status: "interrupted" | "failed",
): Promise<void> {
  const errorMessage =
    status === "interrupted"
      ? `プロセスが中断されました。\n\n【最後の出力】\n${info.lastOutput.slice(-1000)}`
      : `プロセスが異常終了しました。\n\n【最後の出力】\n${info.lastOutput.slice(-1000)}`;

  await prisma.agentExecution.update({
    where: { id: executionId },
    data: {
      status,
      output: info.state.output,
      errorMessage,
      completedAt: new Date(),
    },
  });

  // セッションのステータスも更新
  try {
    await prisma.agentSession.update({
      where: { id: info.sessionId },
      data: {
        status: "interrupted",
        lastActivityAt: new Date(),
      },
    });
  } catch (error) {
    logger.error(
      { err: error, sessionId: info.sessionId },
      `[LifecycleManager] Failed to update session`,
    );
  }

  // タスクのステータスを todo に戻す
  try {
    const task = await prisma.task.findUnique({
      where: { id: info.taskId },
      select: { id: true, status: true },
    });
    if (task && task.status === "in-progress") {
      await prisma.task.update({
        where: { id: info.taskId },
        data: { status: "todo" },
      });
      logger.info(
        `[LifecycleManager] Task ${info.taskId} reverted to 'todo' during shutdown`,
      );
    }
  } catch (error) {
    logger.error(
      { err: error, taskId: info.taskId },
      `[LifecycleManager] Failed to update task`,
    );
  }
}

/**
 * 全てのアクティブなエージェントの状態を保存
 */
export async function saveAllAgentStates(
  prisma: PrismaClientInstance,
  activeAgents: Map<number, ActiveAgentInfo>,
): Promise<void> {
  logger.info(
    `[LifecycleManager] Saving state for ${activeAgents.size} active agents...`,
  );

  for (const [executionId, info] of activeAgents) {
    try {
      await saveAgentState(prisma, executionId, info, "interrupted");
    } catch (error) {
      logger.error(
        { err: error, executionId },
        `[LifecycleManager] Failed to save state for execution`,
      );
    }
  }
}

/**
 * グレースフルシャットダウン
 */
export async function gracefulShutdown(
  ctx: LifecycleContext,
  options?: { skipServerStop?: boolean },
): Promise<void> {
  if (ctx.getIsShuttingDown()) {
    logger.info("[LifecycleManager] Shutdown already in progress");
    return;
  }

  ctx.setIsShuttingDown(true);
  logger.info(
    `[LifecycleManager] Starting graceful shutdown with ${ctx.activeAgents.size} active agents`,
  );

  const shutdownTimeout = 30000;
  const startTime = Date.now();

  try {
    // 全ての質問タイムアウトをキャンセル
    ctx.questionTimeoutManager.cancelAllTimeouts();
    ctx.questionTimeoutManager.clearAllLocks();

    // 全てのアクティブなエージェントを停止
    const stopPromises = Array.from(ctx.activeAgents.entries()).map(
      async ([executionId, info]) => {
        try {
          logger.info(
            `[LifecycleManager] Stopping agent for execution ${executionId}...`,
          );

          await Promise.race([
            info.agent.stop(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Stop timeout")), 10000),
            ),
          ]);

          await saveAgentState(ctx.prisma, executionId, info, "interrupted");
          logger.info(
            `[LifecycleManager] Agent for execution ${executionId} stopped and state saved`,
          );
        } catch (error) {
          logger.error(
            { err: error, executionId },
            `[LifecycleManager] Error stopping agent`,
          );
          try {
            await saveAgentState(ctx.prisma, executionId, info, "interrupted");
          } catch (saveError) {
            logger.error(
              { err: saveError, executionId },
              `[LifecycleManager] Failed to save state`,
            );
          }
        }
      },
    );

    await Promise.race([
      Promise.all(stopPromises),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Shutdown timeout")),
          shutdownTimeout - (Date.now() - startTime),
        ),
      ),
    ]);

    logger.info("[LifecycleManager] Graceful shutdown completed");
  } catch (error) {
    logger.error({ err: error }, "[LifecycleManager] Graceful shutdown error");
    await saveAllAgentStates(ctx.prisma, ctx.activeAgents);
  } finally {
    ctx.activeAgents.clear();
    ctx.activeExecutions.clear();

    if (ctx.serverStopCallback && !options?.skipServerStop) {
      try {
        logger.info("[LifecycleManager] Stopping server listener...");
        await ctx.serverStopCallback();
        logger.info("[LifecycleManager] Server listener stopped");
      } catch (error) {
        logger.error(
          { err: error },
          "[LifecycleManager] Failed to stop server listener",
        );
      }
    }
  }
}

/**
 * シグナルハンドラーを設定
 */
export function setupSignalHandlers(
  shutdownFn: () => Promise<void>,
  saveStatesFn: () => Promise<void>,
): void {
  const handleShutdown = async (signal: string) => {
    logger.info(
      `[LifecycleManager] Received ${signal}, initiating graceful shutdown...`,
    );
    await shutdownFn();
  };

  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("SIGINT", () => handleShutdown("SIGINT"));

  process.on("uncaughtException", async (error) => {
    logger.error({ err: error }, "[LifecycleManager] Uncaught exception");
    await shutdownFn();
    process.exit(1);
  });

  process.on("unhandledRejection", async (reason) => {
    logger.error({ err: reason }, "[LifecycleManager] Unhandled rejection");
    await saveStatesFn();
  });

  logger.info(
    "[LifecycleManager] Signal handlers registered for graceful shutdown",
  );
}
