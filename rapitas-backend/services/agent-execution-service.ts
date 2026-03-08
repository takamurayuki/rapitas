/**
 * Agent Execution Service
 * エージェント実行のライフサイクル管理、セッション管理を行う
 */
import { PrismaClient, AgentExecution, AgentSession } from "@prisma/client";
import { orchestrator } from "../routes/agents/approvals";
import type {
  ExecutionRequest,
  ExecutionResult,
  AgentExecutionWithExtras
} from "../types/agent-execution-types";
import { createLogger } from '../config/logger';

const log = createLogger('agent-execution-service');

export class AgentExecutionService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * タスクの実行を開始
   */
  async executeTask(
    taskId: number,
    request: ExecutionRequest
  ): Promise<ExecutionResult> {
    const {
      agentConfigId,
      useTaskAnalysis = true,
      optimizedPrompt,
      sessionId,
    } = request;

    // タスク情報を取得
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        theme: true
      }
    });

    if (!task) {
      throw new Error("タスクが見つかりません");
    }

    // セッション管理
    const session = await this.getOrCreateSession(sessionId, agentConfigId);

    // 実行前の状態チェック
    await this.checkExecutionPreconditions(session.id);

    // エージェント設定を取得
    const agentConfig = await this.getAgentConfig(agentConfigId || session.configId);

    // 実行データベースエントリを作成
    const execution = await this.createExecution(session.id, agentConfig.id);

    try {
      // 実行をオーケストレーターに委譲
      const executionInstruction = this.buildExecutionInstruction(task, optimizedPrompt, useTaskAnalysis);

      orchestrator.executeTask(
        {
          id: taskId,
          title: task.title,
          description: executionInstruction,
          context: task.executionInstructions || undefined,
        },
        {
          taskId,
          sessionId: session.id,
          agentConfigId: agentConfig.id,
        }
      );

      return {
        success: true,
        executionId: execution.id,
        sessionId: session.id,
        message: "エージェントが実行を開始しました",
      };
    } catch (error) {
      // 実行開始に失敗した場合はエラー状態に更新
      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: "error",
          errorMessage: error instanceof Error ? error.message : "実行開始エラー",
        }
      });

      throw error;
    }
  }

  /**
   * セッションを取得または新規作成
   */
  private async getOrCreateSession(
    sessionId?: number,
    configId?: number
  ): Promise<AgentSession> {
    if (sessionId) {
      const existingSession = await this.prisma.agentSession.findUnique({
        where: { id: sessionId },
      });

      if (!existingSession) {
        throw new Error("指定されたセッションが見つかりません");
      }

      return existingSession;
    }

    // 新規セッション作成
    if (!configId) {
      throw new Error("新規セッション作成にはconfigIdが必要です");
    }

    return await this.prisma.agentSession.create({
      data: {
        configId,
        startedAt: new Date(),
      }
    });
  }

  /**
   * エージェント設定を取得
   */
  private async getAgentConfig(agentConfigId: number) {
    const agentConfig = await this.prisma.aIAgentConfig.findUnique({
      where: { id: agentConfigId },
    });

    if (!agentConfig || !agentConfig.isActive) {
      throw new Error("有効なエージェント設定が見つかりません");
    }

    return agentConfig;
  }

  /**
   * 実行前の条件チェック
   */
  private async checkExecutionPreconditions(sessionId: number): Promise<void> {
    // 既に実行中の処理があるかチェック
    const runningExecution = await this.prisma.agentExecution.findFirst({
      where: {
        sessionId,
        status: { in: ["running", "pending", "waiting_for_input"] }
      }
    });

    if (runningExecution) {
      throw new Error("この実行セッションは既に実行中です");
    }
  }

  /**
   * 実行エントリを作成
   */
  private async createExecution(
    sessionId: number,
    agentConfigId: number
  ): Promise<AgentExecution> {
    return await this.prisma.agentExecution.create({
      data: {
        sessionId,
        agentConfigId,
        command: `Agent execution`,
        status: "pending",
        startedAt: new Date(),
      }
    });
  }

  /**
   * 実行指示文を構築
   */
  private buildExecutionInstruction(
    task: { description: string | null; workflowFiles?: Array<{ fileType: string }> },
    optimizedPrompt?: string,
    useTaskAnalysis?: boolean
  ): string {
    let instruction = task.description || "";

    if (optimizedPrompt) {
      instruction = `${optimizedPrompt}\n\n元のタスク内容:\n${instruction}`;
    }

    if (useTaskAnalysis && task.workflowFiles?.some((f) => f.fileType === "research")) {
      instruction = `## 事前調査済み\n\nこのタスクは事前調査が完了しています。ワークフローファイルを確認してください。\n\n${instruction}`;
    }

    return instruction;
  }

  /**
   * 実行を停止
   */
  async stopExecution(executionId: number): Promise<boolean> {
    try {
      // オーケストレーターで停止を試行
      const stopped = await orchestrator.stopExecution(executionId).catch(() => false);

      // データベースで実行状態を更新
      await this.prisma.agentExecution.update({
        where: { id: executionId },
        data: {
          status: "cancelled",
          completedAt: new Date(),
        }
      });

      return stopped;
    } catch (error) {
      log.error({ err: error }, "Failed to stop execution");
      return false;
    }
  }

  /**
   * セッションを停止
   */
  async stopSession(sessionId: number): Promise<void> {
    // セッションの全実行を停止
    const executions = orchestrator.getSessionExecutions(sessionId);
    for (const execution of executions) {
      await orchestrator.stopExecution(execution.executionId).catch((err) => {
        log.warn({ err, executionId: execution.executionId }, "Failed to stop execution during session stop");
      });
    }

    // データベースで実行中/待機中の実行をすべてキャンセル
    await this.prisma.agentExecution.updateMany({
      where: {
        sessionId,
        status: { in: ["running", "pending", "waiting_for_input"] }
      },
      data: {
        status: "cancelled",
        completedAt: new Date()
      }
    });

    // セッション終了
    await this.prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        completedAt: new Date(),
        status: "completed"
      }
    });
  }

  /**
   * 実行を継続/再開
   */
  async continueExecution(taskId: number, options?: {
    additionalInstructions?: string;
    sessionId?: number;
  }): Promise<ExecutionResult> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        theme: true,
      }
    });

    if (!task) {
      throw new Error("タスクが見つかりません");
    }

    // 既存の実行を検索
    const previousExecution = await this.prisma.agentExecution.findFirst({
      where: {
        ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
        session: {
          config: {
            taskId: taskId
          }
        }
      },
      orderBy: { startedAt: "desc" },
      include: { agentConfig: true }
    });

    if (!previousExecution) {
      throw new Error("継続可能な実行が見つかりません");
    }

    // 実行停止処理
    if (["running", "pending", "waiting_for_input"].includes(previousExecution.status)) {
      await orchestrator.stopExecution(previousExecution.id).catch((err) => {
        log.warn({ err, executionId: previousExecution.id }, "Failed to stop previous execution before resume");
      });
    }

    // 新しい実行エントリを作成
    const newExecution = await this.prisma.agentExecution.create({
      data: {
        sessionId: previousExecution.sessionId,
        agentConfigId: previousExecution.agentConfigId,
        command: "continue_task",
        status: "pending",
        startedAt: new Date(),
      }
    });

    // 継続実行の指示文を構築
    let fullInstruction = task.description || "";

    if (options?.additionalInstructions) {
      fullInstruction = `${options.additionalInstructions}\n\n${fullInstruction}`;
    }

    // 前回の実行内容を含める
    if (previousExecution.output) {
      const prevOutput = previousExecution.output.slice(0, 3000);
      fullInstruction = `## 前回の実行内容\n\n前回の実行で以下の作業を行いました：\n\n${prevOutput}${previousExecution.output.length > 3000 ? "\n...(省略)" : ""}\n\n${fullInstruction}`;
    }

    try {
      // オーケストレーターで実行（同じセッションで継続）
      orchestrator.executeTask(
        {
          id: taskId,
          title: task.title,
          description: fullInstruction,
          context: task.executionInstructions || undefined,
        },
        {
          taskId,
          sessionId: previousExecution.sessionId,
        }
      );

      return {
        success: true,
        executionId: newExecution.id,
        sessionId: previousExecution.sessionId,
        message: "エージェントが継続実行を開始しました",
      };
    } catch (error) {
      await this.prisma.agentExecution.update({
        where: { id: newExecution.id },
        data: {
          status: "error",
          errorMessage: error instanceof Error ? error.message : "継続実行エラー"
        }
      });

      throw error;
    }
  }

  /**
   * 実行ステータスを取得
   */
  async getExecutionStatus(executionId: number): Promise<AgentExecutionWithExtras | null> {
    return await this.prisma.agentExecution.findUnique({
      where: { id: executionId },
      include: {
        agentConfig: true,
        session: true,
        executionLogs: {
          orderBy: { timestamp: "asc" }
        }
      }
    });
  }

  /**
   * タスクの最新実行を取得
   */
  async getLatestExecution(taskId: number): Promise<AgentExecutionWithExtras | null> {
    return await this.prisma.agentExecution.findFirst({
      where: {
        session: {
          config: {
            taskId: taskId
          }
        }
      },
      orderBy: { startedAt: "desc" },
      include: {
        agentConfig: true,
        session: true,
        executionLogs: {
          orderBy: { timestamp: "asc" },
          take: 10
        }
      }
    });
  }

  /**
   * 実行中タスクの一覧を取得
   */
  async getExecutingTasks(): Promise<AgentExecutionWithExtras[]> {
    return await this.prisma.agentExecution.findMany({
      where: {
        status: { in: ["running", "pending", "waiting_for_input"] }
      },
      include: {
        agentConfig: true,
        session: true
      },
      orderBy: { startedAt: "desc" }
    });
  }

  /**
   * 実行状態をリセット
   */
  async resetExecutionState(taskId: number): Promise<void> {
    const latestExecution = await this.prisma.agentExecution.findFirst({
      where: {
        session: {
          config: {
            taskId: taskId
          }
        }
      },
      orderBy: { startedAt: "desc" }
    });

    if (!latestExecution) {
      throw new Error("リセット対象の実行が見つかりません");
    }

    // 実行中の場合は停止
    if (["running", "pending", "waiting_for_input"].includes(latestExecution.status)) {
      await orchestrator.stopExecution(latestExecution.id).catch((err) => {
        log.warn({ err, executionId: latestExecution.id }, "Failed to stop execution before reset");
      });
    }

    // 実行状態をリセット
    await this.prisma.agentExecution.update({
      where: { id: latestExecution.id },
      data: {
        status: "cancelled",
        completedAt: new Date()
      }
    });

    // 実行ログを削除
    await this.prisma.agentExecutionLog.deleteMany({
      where: { executionId: latestExecution.id }
    });
  }

  /**
   * 復帰可能な実行の一覧を取得
   */
  async getResumableExecutions(): Promise<AgentExecutionWithExtras[]> {
    return await this.prisma.agentExecution.findMany({
      where: {
        status: "interrupted",
        completedAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } // 24時間以内
      },
      include: {
        agentConfig: true,
        session: true
      },
      orderBy: { completedAt: "desc" }
    });
  }

  /**
   * 中断された実行の一覧を取得
   */
  async getInterruptedExecutions(): Promise<AgentExecutionWithExtras[]> {
    return await this.prisma.agentExecution.findMany({
      where: {
        status: { in: ["interrupted", "error", "cancelled"] },
        completedAt: { gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // 1週間以内
      },
      include: {
        agentConfig: true,
        session: true
      },
      orderBy: { completedAt: "desc" }
    });
  }
}

// シングルトンインスタンスをエクスポート
export const agentExecutionService = (prisma: PrismaClient) => new AgentExecutionService(prisma);