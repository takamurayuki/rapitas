/**
 * Agent Execution Service
 *
 * Manages agent execution lifecycle and session management.
 * Implementation is split across sub-modules for size compliance:
 *   - agent-execution/execution-helpers.ts  — session/config helpers and instruction builder
 *   - agent-execution/execution-core.ts     — start/stop/stopSession
 *   - agent-execution/execution-continue.ts — continueExecution
 *   - agent-execution/execution-queries.ts  — read queries and reset
 */
import { PrismaClient } from '@prisma/client';
import type {
  ExecutionRequest,
  ExecutionResult,
  AgentExecutionWithExtras,
} from '../../types/agent-execution-types';
import {
  executeTask as _executeTask,
  stopExecution as _stopExecution,
  stopSession as _stopSession,
} from '../agent-execution/execution-core';
import { continueExecution as _continueExecution } from '../agent-execution/execution-continue';
import {
  getExecutionStatus as _getExecutionStatus,
  getLatestExecution as _getLatestExecution,
  getExecutingTasks as _getExecutingTasks,
  resetExecutionState as _resetExecutionState,
  getResumableExecutions as _getResumableExecutions,
  getInterruptedExecutions as _getInterruptedExecutions,
} from '../agent-execution/execution-queries';

export class AgentExecutionService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /** Starts task execution with an agent. */
  async executeTask(taskId: number, request: ExecutionRequest): Promise<ExecutionResult> {
    return _executeTask(this.prisma, taskId, request);
  }

  /** Stops a running execution. */
  async stopExecution(executionId: number): Promise<boolean> {
    return _stopExecution(this.prisma, executionId);
  }

  /** Stops all executions in a session and marks it as completed. */
  async stopSession(sessionId: number): Promise<void> {
    return _stopSession(this.prisma, sessionId);
  }

  /** Continues or resumes a previous execution with optional additional instructions. */
  async continueExecution(
    taskId: number,
    options?: { additionalInstructions?: string; sessionId?: number },
  ): Promise<ExecutionResult> {
    return _continueExecution(this.prisma, taskId, options);
  }

  /** Returns the execution status with related data. */
  async getExecutionStatus(executionId: number): Promise<AgentExecutionWithExtras | null> {
    return _getExecutionStatus(this.prisma, executionId);
  }

  /** Retrieves the most recent execution for a task. */
  async getLatestExecution(taskId: number): Promise<AgentExecutionWithExtras | null> {
    return _getLatestExecution(this.prisma, taskId);
  }

  /** Lists all currently active executions. */
  async getExecutingTasks(): Promise<AgentExecutionWithExtras[]> {
    return _getExecutingTasks(this.prisma);
  }

  /** Resets the execution state for a task, stopping and cleaning up logs. */
  async resetExecutionState(taskId: number): Promise<void> {
    return _resetExecutionState(this.prisma, taskId);
  }

  /** Lists interrupted executions that can be resumed (within 24 hours). */
  async getResumableExecutions(): Promise<AgentExecutionWithExtras[]> {
    return _getResumableExecutions(this.prisma);
  }

  /** Lists failed/interrupted/cancelled executions within the past week. */
  async getInterruptedExecutions(): Promise<AgentExecutionWithExtras[]> {
    return _getInterruptedExecutions(this.prisma);
  }
}

// Factory export
export const agentExecutionService = (prisma: PrismaClient) => new AgentExecutionService(prisma);
