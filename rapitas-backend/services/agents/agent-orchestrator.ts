/**
 * エージェントオーケストレーター
 * エージェントの実行管理、状態追跡、イベント配信を担当
 */

import { PrismaClient } from '@prisma/client';
import { agentFactory, AgentConfigInput } from './agent-factory';
import {
  BaseAgent,
  AgentTask,
  AgentExecutionResult,
  AgentOutputHandler,
  AgentStatus,
} from './base-agent';

export type ExecutionOptions = {
  taskId: number;
  sessionId: number;
  agentConfigId?: number;
  workingDirectory?: string;
  timeout?: number;
  requireApproval?: boolean;
  onOutput?: AgentOutputHandler;
};

export type ExecutionState = {
  executionId: number;
  sessionId: number;
  agentId: string;
  taskId: number;
  status: AgentStatus;
  startedAt: Date;
  output: string;
};

export type OrchestratorEvent = {
  type: 'execution_started' | 'execution_output' | 'execution_completed' | 'execution_failed' | 'execution_cancelled';
  executionId: number;
  sessionId: number;
  taskId: number;
  data?: unknown;
  timestamp: Date;
};

export type EventListener = (event: OrchestratorEvent) => void;

/**
 * エージェントオーケストレータークラス
 */
export class AgentOrchestrator {
  private static instance: AgentOrchestrator;
  private prisma: PrismaClient;
  private activeExecutions: Map<number, ExecutionState> = new Map();
  private eventListeners: Set<EventListener> = new Set();

  private constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  static getInstance(prisma: PrismaClient): AgentOrchestrator {
    if (!AgentOrchestrator.instance) {
      AgentOrchestrator.instance = new AgentOrchestrator(prisma);
    }
    return AgentOrchestrator.instance;
  }

  /**
   * イベントリスナーを追加
   */
  addEventListener(listener: EventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   * イベントリスナーを削除
   */
  removeEventListener(listener: EventListener): void {
    this.eventListeners.delete(listener);
  }

  /**
   * イベントを発火
   */
  private emitEvent(event: OrchestratorEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in event listener:', error);
      }
    }
  }

  /**
   * タスクを実行
   */
  async executeTask(
    task: AgentTask,
    options: ExecutionOptions
  ): Promise<AgentExecutionResult> {
    // エージェント設定を取得
    let agentConfig: AgentConfigInput = {
      type: 'claude-code',
      name: 'Claude Code Agent',
      workingDirectory: options.workingDirectory,
      timeout: options.timeout,
    };

    if (options.agentConfigId) {
      const dbConfig = await this.prisma.aIAgentConfig.findUnique({
        where: { id: options.agentConfigId },
      });
      if (dbConfig) {
        agentConfig = {
          type: dbConfig.agentType as 'claude-code',
          name: dbConfig.name,
          endpoint: dbConfig.endpoint || undefined,
          modelId: dbConfig.modelId || undefined,
          workingDirectory: options.workingDirectory,
          timeout: options.timeout,
        };
      }
    }

    // エージェントを作成
    const agent = agentFactory.createAgent(agentConfig);

    // 実行レコードを作成
    const execution = await this.prisma.agentExecution.create({
      data: {
        sessionId: options.sessionId,
        agentConfigId: options.agentConfigId,
        command: task.description || task.title,
        status: 'pending',
      },
    });

    // 実行状態を追跡
    const state: ExecutionState = {
      executionId: execution.id,
      sessionId: options.sessionId,
      agentId: agent.id,
      taskId: options.taskId,
      status: 'idle',
      startedAt: new Date(),
      output: '',
    };
    this.activeExecutions.set(execution.id, state);

    // 出力ハンドラを設定
    agent.setOutputHandler((output, isError) => {
      state.output += output;
      if (options.onOutput) {
        options.onOutput(output, isError);
      }
      this.emitEvent({
        type: 'execution_output',
        executionId: execution.id,
        sessionId: options.sessionId,
        taskId: options.taskId,
        data: { output, isError },
        timestamp: new Date(),
      });
    });

    // 実行開始イベント
    this.emitEvent({
      type: 'execution_started',
      executionId: execution.id,
      sessionId: options.sessionId,
      taskId: options.taskId,
      timestamp: new Date(),
    });

    // 実行レコードを更新
    await this.prisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: 'running',
        startedAt: new Date(),
      },
    });

    try {
      // エージェントを実行
      const result = await agent.execute(task);
      state.status = result.success ? 'completed' : 'failed';

      // 実行レコードを更新
      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: result.success ? 'completed' : 'failed',
          output: result.output,
          artifacts: result.artifacts ? JSON.parse(JSON.stringify(result.artifacts)) : null,
          completedAt: new Date(),
          tokensUsed: result.tokensUsed || 0,
          executionTimeMs: result.executionTimeMs,
          errorMessage: result.errorMessage,
        },
      });

      // セッションのトークン使用量を更新
      if (result.tokensUsed) {
        await this.prisma.agentSession.update({
          where: { id: options.sessionId },
          data: {
            totalTokensUsed: {
              increment: result.tokensUsed,
            },
            lastActivityAt: new Date(),
          },
        });
      }

      // Gitコミットを記録
      if (result.commits && result.commits.length > 0) {
        for (const commit of result.commits) {
          await this.prisma.gitCommit.create({
            data: {
              executionId: execution.id,
              commitHash: commit.hash,
              message: commit.message,
              branch: commit.branch,
              filesChanged: commit.filesChanged,
              additions: commit.additions,
              deletions: commit.deletions,
            },
          });
        }
      }

      // 完了イベント
      this.emitEvent({
        type: result.success ? 'execution_completed' : 'execution_failed',
        executionId: execution.id,
        sessionId: options.sessionId,
        taskId: options.taskId,
        data: result,
        timestamp: new Date(),
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      state.status = 'failed';

      // エラー時の更新
      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: 'failed',
          output: state.output,
          completedAt: new Date(),
          errorMessage,
        },
      });

      this.emitEvent({
        type: 'execution_failed',
        executionId: execution.id,
        sessionId: options.sessionId,
        taskId: options.taskId,
        data: { errorMessage },
        timestamp: new Date(),
      });

      throw error;
    } finally {
      // クリーンアップ
      this.activeExecutions.delete(execution.id);
      await agentFactory.removeAgent(agent.id);
    }
  }

  /**
   * 実行を停止
   */
  async stopExecution(executionId: number): Promise<boolean> {
    const state = this.activeExecutions.get(executionId);
    if (!state) {
      return false;
    }

    const agent = agentFactory.getAgent(state.agentId);
    if (!agent) {
      return false;
    }

    await agent.stop();

    // 実行レコードを更新
    await this.prisma.agentExecution.update({
      where: { id: executionId },
      data: {
        status: 'cancelled',
        output: state.output,
        completedAt: new Date(),
      },
    });

    this.emitEvent({
      type: 'execution_cancelled',
      executionId,
      sessionId: state.sessionId,
      taskId: state.taskId,
      timestamp: new Date(),
    });

    return true;
  }

  /**
   * アクティブな実行を取得
   */
  getActiveExecutions(): ExecutionState[] {
    return Array.from(this.activeExecutions.values());
  }

  /**
   * 特定のセッションの実行を取得
   */
  getSessionExecutions(sessionId: number): ExecutionState[] {
    return Array.from(this.activeExecutions.values()).filter(
      (state) => state.sessionId === sessionId
    );
  }

  /**
   * 実行状態を取得
   */
  getExecutionState(executionId: number): ExecutionState | undefined {
    return this.activeExecutions.get(executionId);
  }
}

// ファクトリー関数
export function createOrchestrator(prisma: PrismaClient): AgentOrchestrator {
  return AgentOrchestrator.getInstance(prisma);
}
