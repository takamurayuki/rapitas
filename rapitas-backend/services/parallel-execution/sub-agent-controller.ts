/**
 * SubAgentController
 *
 * Orchestrates a pool of SubAgent instances: creates agents, dispatches tasks,
 * manages the self-healing retry loop, and provides inter-agent message
 * broadcasting. Process lifecycle details live in sub-agent/process-manager.ts;
 * retry logic lives in sub-agent/retry-helpers.ts.
 */
import { EventEmitter } from 'events';
import { createLogger } from '../../config/logger';
import type {
  SubAgentState,
  AgentMessage,
  AgentMessageType,
  ExecutionLogEntry,
  ParallelExecutionConfig,
} from './types';
import type { AgentTask, AgentExecutionResult } from '../agents/base-agent';
import { SubAgent } from './sub-agent/process-manager';
import { classifyFailure, buildRetryContext } from './sub-agent/retry-helpers';

const logger = createLogger('sub-agent-controller');

/**
 * Manages the pool of sub-agents for a parallel execution session.
 *
 * Emits:
 * - `agent_output` ({ agentId, taskId, executionId, chunk, isError, timestamp })
 * - `task_started` ({ agentId, taskId, timestamp })
 * - `task_completed` ({ agentId, taskId, result, timestamp })
 * - `task_failed` ({ agentId, taskId, result | error, timestamp })
 * - `message` (AgentMessage) — coordination messages
 * - `log` (ExecutionLogEntry)
 */
export class SubAgentController extends EventEmitter {
  private agents: Map<string, SubAgent> = new Map();
  private config: ParallelExecutionConfig;
  private messageQueue: AgentMessage[] = [];
  private isProcessingMessages: boolean = false;

  constructor(config: ParallelExecutionConfig) {
    super();
    this.config = config;
  }

  /**
   * Create a new sub-agent for the given task and register it in the pool.
   *
   * @param taskId - Task ID / タスクID
   * @param executionId - Execution ID / 実行ID
   * @param workingDirectory - Working directory for the Claude CLI / 作業ディレクトリ
   * @returns Agent ID / エージェントID
   */
  createAgent(taskId: number, executionId: number, workingDirectory: string): string {
    const agentId = `agent-${taskId}-${Date.now()}`;

    const agent = new SubAgent({
      agentId,
      taskId,
      executionId,
      workingDirectory,
      timeout: this.config.taskTimeoutSeconds * 1000,
      dangerouslySkipPermissions: true,
      state: {
        agentId,
        taskId,
        executionId,
        status: 'pending',
        startedAt: new Date(),
        lastActivityAt: new Date(),
        watingForInput: false,
        output: '',
        artifacts: [],
        tokensUsed: 0,
        executionTimeMs: 0,
      },
    });

    agent.on('output', (chunk: string, isError: boolean) => {
      this.emit('agent_output', {
        agentId,
        taskId,
        executionId,
        chunk,
        isError,
        timestamp: new Date(),
      });

      if (this.config.logSharing) {
        this.broadcastMessage({
          id: `msg-${Date.now()}`,
          timestamp: new Date(),
          fromAgentId: agentId,
          toAgentId: 'broadcast',
          type: 'task_progress',
          payload: {
            taskId,
            chunk: chunk.slice(0, 500),
          },
        });
      }
    });

    this.agents.set(agentId, agent);

    const logFilePath = agent.getLogFilePath();
    logger.info(`[SubAgentController] Created agent ${agentId} for task ${taskId}`);
    logger.info(`[SubAgentController] Log file: ${logFilePath}`);

    return agentId;
  }

  /**
   * Return the log file path for a registered agent.
   *
   * @param agentId - Agent ID / エージェントID
   * @returns Absolute path or null if not found / 絶対パスまたはnull
   */
  getAgentLogFilePath(agentId: string): string | null {
    const agent = this.agents.get(agentId);
    return agent ? agent.getLogFilePath() : null;
  }

  /**
   * Execute a task using the specified agent, with automatic retry on recoverable failures.
   *
   * @param agentId - Agent ID / エージェントID
   * @param task - Task to execute / 実行するタスク
   * @returns Execution result / 実行結果
   * @throws {Error} When agent is not found / エージェントが見つからない場合
   */
  async executeTask(agentId: string, task: AgentTask): Promise<AgentExecutionResult> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    this.emit('task_started', {
      agentId,
      taskId: task.id,
      timestamp: new Date(),
    });

    this.broadcastMessage({
      id: `msg-${Date.now()}`,
      timestamp: new Date(),
      fromAgentId: agentId,
      toAgentId: 'broadcast',
      type: 'task_started',
      payload: { taskId: task.id, title: task.title },
    });

    const maxRetries = this.config.retryOnFailure ? (this.config.maxRetries || 3) : 0;

    try {
      let result = await agent.execute(task);
      let retryCount = 0;

      // NOTE: Self-healing loop — retry on retryable failures (test/lint/type errors)
      while (!result.success && !result.waitingForInput && retryCount < maxRetries) {
        const failureType = classifyFailure(result.output, result.errorMessage);
        if (failureType === 'unknown') break;

        retryCount++;
        logger.info(
          `[SubAgentController] Task ${task.id} retry ${retryCount}/${maxRetries} (${failureType})`,
        );

        // NOTE: Inject error context so the agent knows what to fix on the next attempt
        const errorContext = buildRetryContext(failureType, result.output, result.errorMessage);
        const retryTask: AgentTask = {
          ...task,
          description: `${task.description || task.title}\n\n---\n## 前回の実行で発生したエラー（自動リトライ ${retryCount}/${maxRetries}）\n\n${errorContext}\n\n上記のエラーを修正してタスクを完了してください。`,
          resumeSessionId: result.claudeSessionId || task.resumeSessionId,
        };

        const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 10000);
        await new Promise((r) => setTimeout(r, delay));

        result = await agent.execute(retryTask);
      }

      result.retryCount = retryCount;
      if (!result.success && retryCount > 0) {
        result.failureType = classifyFailure(result.output, result.errorMessage);
      }

      this.emit(result.success ? 'task_completed' : 'task_failed', {
        agentId,
        taskId: task.id,
        result,
        timestamp: new Date(),
      });

      this.broadcastMessage({
        id: `msg-${Date.now()}`,
        timestamp: new Date(),
        fromAgentId: agentId,
        toAgentId: 'broadcast',
        type: result.success ? 'task_completed' : 'task_failed',
        payload: {
          taskId: task.id,
          success: result.success,
          executionTimeMs: result.executionTimeMs,
          retryCount,
        },
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.emit('task_failed', {
        agentId,
        taskId: task.id,
        error: errorMessage,
        timestamp: new Date(),
      });

      this.broadcastMessage({
        id: `msg-${Date.now()}`,
        timestamp: new Date(),
        fromAgentId: agentId,
        toAgentId: 'broadcast',
        type: 'task_failed',
        payload: { taskId: task.id, error: errorMessage },
      });

      return {
        success: false,
        output: '',
        errorMessage,
      };
    }
  }

  /**
   * Stop a specific agent by ID.
   *
   * @param agentId - Agent ID to stop / 停止するエージェントID
   */
  stopAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.stop();
      logger.info(`[SubAgentController] Stopped agent ${agentId}`);
    }
  }

  /** Stop all registered agents and clear the pool. */
  stopAllAgents(): void {
    for (const [_agentId, agent] of this.agents) {
      agent.stop();
    }
    this.agents.clear();
    logger.info('[SubAgentController] Stopped all agents');
  }

  /**
   * Return a snapshot of a single agent's state.
   *
   * @param agentId - Agent ID / エージェントID
   * @returns State snapshot or null / 状態スナップショットまたはnull
   */
  getAgentState(agentId: string): SubAgentState | null {
    const agent = this.agents.get(agentId);
    return agent ? agent.getState() : null;
  }

  /**
   * Return a map of all agents' current states.
   *
   * @returns Map of agentId → state / エージェントID→状態のMap
   */
  getAllAgentStates(): Map<string, SubAgentState> {
    const states = new Map<string, SubAgentState>();
    for (const [agentId, agent] of this.agents) {
      states.set(agentId, agent.getState());
    }
    return states;
  }

  /**
   * Return the count of agents currently in 'running' status.
   *
   * @returns Active agent count / アクティブエージェント数
   */
  getActiveAgentCount(): number {
    let count = 0;
    for (const agent of this.agents.values()) {
      if (agent.getStatus() === 'running') {
        count++;
      }
    }
    return count;
  }

  /**
   * Broadcast a coordination message to all agents (no-op if coordinationEnabled is false).
   *
   * @param message - Message to broadcast / ブロードキャストするメッセージ
   */
  broadcastMessage(message: AgentMessage): void {
    if (!this.config.coordinationEnabled) return;

    this.messageQueue.push(message);
    this.processMessageQueue();

    this.emit('message', message);
  }

  /**
   * Send a directed message from one agent to another.
   *
   * @param toAgentId - Recipient agent ID / 宛先エージェントID
   * @param fromAgentId - Sender agent ID / 送信元エージェントID
   * @param type - Message type / メッセージタイプ
   * @param payload - Message payload / メッセージペイロード
   */
  sendMessage(
    toAgentId: string,
    fromAgentId: string,
    type: AgentMessageType,
    payload: unknown,
  ): void {
    if (!this.config.coordinationEnabled) return;

    const message: AgentMessage = {
      id: `msg-${Date.now()}`,
      timestamp: new Date(),
      fromAgentId,
      toAgentId,
      type,
      payload,
    };

    this.messageQueue.push(message);
    this.processMessageQueue();

    this.emit('message', message);
  }

  /** Drain the message queue, emitting a log entry per message. */
  private async processMessageQueue(): Promise<void> {
    if (this.isProcessingMessages || this.messageQueue.length === 0) return;

    this.isProcessingMessages = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      this.logMessage(message);
    }

    this.isProcessingMessages = false;
  }

  /** Convert a coordination message into an ExecutionLogEntry and emit it. */
  private logMessage(message: AgentMessage): void {
    const entry: ExecutionLogEntry = {
      timestamp: message.timestamp,
      agentId: message.fromAgentId,
      taskId: 0,
      level: 'info',
      message: `[${message.type}] ${JSON.stringify(message.payload).slice(0, 200)}`,
      metadata: {
        messageId: message.id,
        toAgentId: message.toAgentId,
        type: message.type,
      },
    };

    this.emit('log', entry);
  }

  /**
   * Stop a specific agent and remove it from the pool.
   *
   * @param agentId - Agent ID to remove / 削除するエージェントID
   */
  removeAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.stop();
      this.agents.delete(agentId);
      logger.info(`[SubAgentController] Removed agent ${agentId}`);
    }
  }

  /**
   * Return task IDs of all currently running agents.
   *
   * @returns Array of running task IDs / 実行中タスクIDの配列
   */
  getRunningTaskIds(): number[] {
    const taskIds: number[] = [];
    for (const agent of this.agents.values()) {
      if (agent.getStatus() === 'running') {
        taskIds.push(agent.config.taskId);
      }
    }
    return taskIds;
  }
}

/**
 * Factory function for SubAgentController.
 *
 * @param config - Parallel execution configuration / 並列実行設定
 * @returns New SubAgentController instance / 新しいSubAgentControllerインスタンス
 */
export function createSubAgentController(config: ParallelExecutionConfig): SubAgentController {
  return new SubAgentController(config);
}
