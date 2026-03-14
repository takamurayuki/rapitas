/**
 * Agent Worker Process
 *
 * エージェント実行を専用プロセスで処理し、メインプロセスのブロッキングを防止する。
 * IPC（プロセス間通信）でメインプロセスと連携し、リアルタイムイベントを送信する。
 */

import { createLogger } from '../config/logger';
import { PrismaClient } from '@prisma/client';
import { AgentOrchestrator } from '../services/agents/agent-orchestrator';
import type { ExecutionOptions, OrchestratorEvent } from '../services/agents/orchestrator/types';
import type { AgentTask, AgentExecutionResult } from '../services/agents/base-agent';

const logger = createLogger('agent-worker');

// IPC Message Types
interface IPCMessage {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

type WorkerIPCMessage = IPCMessage;

class AgentWorker {
  private prisma: PrismaClient;
  private orchestrator: AgentOrchestrator;
  private isShuttingDown = false;

  constructor() {
    this.prisma = new PrismaClient({
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });

    // ワーカープロセス専用のOrchestrator
    this.orchestrator = AgentOrchestrator.getInstance(this.prisma);

    // Orchestratorのイベントリスナーを設定（メインプロセスにIPC送信）
    this.orchestrator.addEventListener((event: OrchestratorEvent) => {
      this.sendIPCMessage({
        type: 'orchestrator-event',
        data: {
          eventType: event.type,
          executionId: event.executionId,
          sessionId: event.sessionId,
          taskId: event.taskId,
          timestamp: event.timestamp.toISOString(),
          data: event.data,
        },
      });
    });

    this.setupIPCHandlers();
    this.setupGracefulShutdown();
  }

  private setupIPCHandlers(): void {
    process.on('message', (message: WorkerIPCMessage) => {
      this.handleIPCMessage(message);
    });

    process.on('disconnect', () => {
      logger.info('[AgentWorker] IPC channel disconnected');
      this.gracefulShutdown();
    });
  }

  private async handleIPCMessage(message: WorkerIPCMessage): Promise<void> {
    const { id, type, data } = message;

    if (this.isShuttingDown && type !== 'shutdown') {
      this.sendIPCResponse(id, { success: false, error: 'Worker is shutting down' });
      return;
    }

    try {
      let result: unknown;

      switch (type) {
        case 'execute-task':
          result = await this.handleExecuteTask(
            data.task as AgentTask,
            data.options as ExecutionOptions,
          );
          break;

        case 'continue-execution':
          result = await this.orchestrator.executeContinuation(
            data.executionId as number,
            data.response as string,
            (data.options as Partial<ExecutionOptions>) || {},
          );
          break;

        case 'continue-with-lock':
          result = await this.orchestrator.executeContinuationWithLock(
            data.executionId as number,
            data.response as string,
            (data.options as Partial<ExecutionOptions>) || {},
          );
          break;

        case 'stop-execution':
          result = await this.orchestrator.stopExecution(data.executionId as number);
          break;

        case 'get-session-executions':
          result = this.orchestrator.getSessionExecutions(data.sessionId as number).map((s) => ({
            executionId: s.executionId,
            sessionId: s.sessionId,
            agentId: s.agentId,
            taskId: s.taskId,
            status: s.status,
            startedAt: s.startedAt.toISOString(),
            output: s.output,
          }));
          break;

        case 'get-active-count':
          result = this.orchestrator.getActiveExecutionCount();
          break;

        case 'get-active-agent-infos':
          result = this.orchestrator.getActiveAgentInfos().map((info) => ({
            ...info,
            startedAt: info.startedAt.toISOString(),
          }));
          break;

        case 'get-execution-state': {
          const state = this.orchestrator.getExecutionState(data.executionId as number);
          result = state
            ? {
                executionId: state.executionId,
                sessionId: state.sessionId,
                agentId: state.agentId,
                taskId: state.taskId,
                status: state.status,
                startedAt: state.startedAt.toISOString(),
                output: state.output,
              }
            : null;
          break;
        }

        case 'try-acquire-lock':
          result = this.orchestrator.tryAcquireContinuationLock(
            data.executionId as number,
            data.source as 'user_response' | 'auto_timeout',
          );
          break;

        case 'release-lock':
          this.orchestrator.releaseContinuationLock(data.executionId as number);
          result = true;
          break;

        case 'cancel-timeout':
          this.orchestrator.cancelQuestionTimeout(data.executionId as number);
          result = true;
          break;

        case 'get-timeout-info': {
          const info = this.orchestrator.getQuestionTimeoutInfo(data.executionId as number);
          result = info ? { ...info, deadline: info.deadline.toISOString() } : null;
          break;
        }

        case 'create-branch':
          result = await this.orchestrator.createBranch(
            data.workingDirectory as string,
            data.branchName as string,
          );
          break;

        case 'revert-changes':
          result = await this.orchestrator.revertChanges(data.workingDirectory as string);
          break;

        case 'get-full-git-diff':
          result = await this.orchestrator.getFullGitDiff(data.workingDirectory as string);
          break;

        case 'get-diff':
          result = await this.orchestrator.getDiff(data.workingDirectory as string);
          break;

        case 'commit-changes':
          result = await this.orchestrator.commitChanges(
            data.workingDirectory as string,
            data.message as string,
            data.taskTitle as string | undefined,
          );
          break;

        case 'create-pull-request':
          result = await this.orchestrator.createPullRequest(
            data.workingDirectory as string,
            data.title as string,
            data.body as string,
            (data.baseBranch as string) || 'main',
          );
          break;

        case 'create-commit':
          result = await this.orchestrator.createCommit(
            data.workingDirectory as string,
            data.message as string,
          );
          break;

        case 'merge-pull-request':
          result = await this.orchestrator.mergePullRequest(
            data.workingDirectory as string,
            data.prNumber as number,
            (data.commitThreshold as number) || 5,
            (data.baseBranch as string) || 'master',
          );
          break;

        case 'get-git-diff':
          result = await this.orchestrator.getGitDiff(data.workingDirectory as string);
          break;

        case 'recover-stale':
          result = await this.orchestrator.recoverStaleExecutions();
          break;

        case 'resume-execution':
          result = await this.orchestrator.resumeInterruptedExecution(
            data.executionId as number,
            (data.options as Partial<ExecutionOptions>) || {},
          );
          break;

        case 'get-status':
          result = {
            activeExecutionCount: this.orchestrator.getActiveExecutionCount(),
            activeAgents: this.orchestrator.getActiveAgentInfos(),
            isShuttingDown: this.isShuttingDown,
          };
          break;

        case 'shutdown':
          this.isShuttingDown = true;
          await this.orchestrator.gracefulShutdown({ skipServerStop: true });
          await this.prisma.$disconnect();
          this.sendIPCResponse(id, { success: true, data: true });
          logger.info('[AgentWorker] Shutdown complete');
          setTimeout(() => process.exit(0), 500);
          return;

        default:
          throw new Error(`Unknown message type: ${type}`);
      }

      this.sendIPCResponse(id, { success: true, data: result });
    } catch (error) {
      logger.error({ err: error, messageType: type }, '[AgentWorker] Error handling IPC message');
      this.sendIPCResponse(id, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async handleExecuteTask(
    task: AgentTask,
    options: ExecutionOptions,
  ): Promise<AgentExecutionResult> {
    logger.info({ taskId: task.id, taskTitle: task.title }, '[AgentWorker] Executing task');
    return await this.orchestrator.executeTask(task, options);
  }

  private sendIPCMessage(message: { type: string; data: Record<string, unknown> }): void {
    if (process.send) {
      process.send(message);
    } else {
      logger.warn('[AgentWorker] IPC channel not available');
    }
  }

  private sendIPCResponse(
    id: string,
    response: { success: boolean; data?: unknown; error?: string },
  ): void {
    this.sendIPCMessage({
      type: 'response',
      data: { id, ...response } as Record<string, unknown>,
    });
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) {
        return;
      }

      logger.info({ signal }, '[AgentWorker] Received shutdown signal');
      this.isShuttingDown = true;

      this.sendIPCMessage({
        type: 'worker-shutting-down',
        data: { signal },
      });

      await this.gracefulShutdown();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  private async gracefulShutdown(): Promise<void> {
    const timeout = 10000;
    const timer = setTimeout(() => {
      logger.error('[AgentWorker] Graceful shutdown timeout, forcing exit');
      process.exit(1);
    }, timeout);

    try {
      logger.info('[AgentWorker] Shutting down orchestrator...');
      await this.orchestrator.gracefulShutdown({ skipServerStop: true });

      logger.info('[AgentWorker] Closing database connection...');
      await this.prisma.$disconnect();

      clearTimeout(timer);
      logger.info('[AgentWorker] Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, '[AgentWorker] Error during graceful shutdown');
      clearTimeout(timer);
      process.exit(1);
    }
  }

  public async start(): Promise<void> {
    try {
      logger.info('[AgentWorker] Agent worker process started');

      await this.prisma.$connect();
      logger.info('[AgentWorker] Database connection established');

      // メインプロセスに起動完了を通知
      this.sendIPCMessage({
        type: 'worker-ready',
        data: { pid: process.pid },
      });

      logger.info('[AgentWorker] Agent worker fully initialized');
    } catch (error) {
      logger.error({ err: error }, '[AgentWorker] Failed to start worker');
      process.exit(1);
    }
  }
}

// ワーカープロセスとして実行された場合の初期化
const worker = new AgentWorker();
worker.start().catch((error) => {
  logger.error({ err: error }, '[AgentWorker] Fatal error during startup');
  process.exit(1);
});

export { AgentWorker };
