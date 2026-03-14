/**
 * Agent Abstraction Layer - Execution Manager
 *
 * Manages and coordinates multiple agent executions.
 */

import { createLogger } from '../../../config/logger';

const pinoLog = createLogger('agent-execution-manager');

import type {
  AgentState,
  AgentExecutionContext,
  AgentTaskDefinition,
  AgentExecutionResult,
  AgentProviderConfig,
} from './types';
import type { IAgent, IAgentExecutionManager, IAgentLogger } from './interfaces';
import { AgentRegistry } from './registry';
import { generateExecutionId } from './index';

/**
 * Execution tracking info.
 */
interface ExecutionInfo {
  executionId: string;
  agentId: string;
  agent: IAgent;
  state: AgentState;
  startTime: Date;
  task: AgentTaskDefinition;
  context: AgentExecutionContext;
}

/**
 * Execution manager options.
 */
interface ExecutionManagerOptions {
  maxConcurrentExecutions?: number;
  defaultTimeout?: number;
  logger?: IAgentLogger;
}

/**
 * Agent execution manager.
 * Manages multiple agent executions and tracks their state.
 */
export class AgentExecutionManager implements IAgentExecutionManager {
  private executions: Map<string, ExecutionInfo> = new Map();
  private agentExecutions: Map<string, Set<string>> = new Map(); // agentId -> executionIds
  private maxConcurrentExecutions: number;
  private defaultTimeout: number;
  private logger?: IAgentLogger;

  constructor(options: ExecutionManagerOptions = {}) {
    this.maxConcurrentExecutions = options.maxConcurrentExecutions ?? 10;
    this.defaultTimeout = options.defaultTimeout ?? 900000; // 15 minutes
    this.logger = options.logger;
  }

  /**
   * Executes a task with a specific agent.
   */
  async executeTask(
    agentId: string,
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    // Get agent from registry
    const registry = AgentRegistry.getInstance();
    const agent = registry.getAgent(agentId);

    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Check concurrent execution limit
    const activeCount = this.getActiveExecutionCount();
    if (activeCount >= this.maxConcurrentExecutions) {
      throw new Error(`Maximum concurrent executions (${this.maxConcurrentExecutions}) reached`);
    }

    // Generate execution ID
    const executionId = context.executionId || generateExecutionId();
    const executionContext: AgentExecutionContext = {
      ...context,
      executionId,
      timeout: context.timeout ?? this.defaultTimeout,
    };

    // Register execution info
    const executionInfo: ExecutionInfo = {
      executionId,
      agentId,
      agent,
      state: 'initializing',
      startTime: new Date(),
      task,
      context: executionContext,
    };

    this.executions.set(executionId, executionInfo);
    this.addAgentExecution(agentId, executionId);

    this.log('info', `Starting execution ${executionId} for agent ${agentId}`);

    try {
      // Subscribe to state change events
      const unsubscribe = agent.events.on('state_change', (event) => {
        if ('newState' in event) {
          executionInfo.state = event.newState;
        }
      });

      // Execute task
      const result = await agent.execute(task, executionContext);

      // Unsubscribe
      unsubscribe();

      // Update execution info
      executionInfo.state = result.state;

      this.log('info', `Execution ${executionId} completed with state: ${result.state}`);

      // Schedule cleanup after completion
      if (
        result.state === 'completed' ||
        result.state === 'failed' ||
        result.state === 'cancelled'
      ) {
        setTimeout(() => {
          this.cleanupExecution(executionId);
        }, 60000); // cleanup after 1 minute
      }

      return result;
    } catch (error) {
      executionInfo.state = 'failed';

      this.log(
        'error',
        `Execution ${executionId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      // Schedule cleanup even on error
      setTimeout(() => {
        this.cleanupExecution(executionId);
      }, 60000);

      throw error;
    }
  }

  /**
   * Continues execution after user response.
   */
  async continueExecution(
    executionId: string,
    userResponse: string,
  ): Promise<AgentExecutionResult> {
    const executionInfo = this.executions.get(executionId);

    if (!executionInfo) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (executionInfo.state !== 'waiting_for_input') {
      throw new Error(
        `Cannot continue execution: state is '${executionInfo.state}', expected 'waiting_for_input'`,
      );
    }

    this.log('info', `Continuing execution ${executionId} with user response`);

    try {
      // Create continuation context
      const continuationContext = {
        sessionId: executionInfo.context.sessionId || executionId,
        previousExecutionId: executionId,
        userResponse,
      };

      // Generate new execution ID
      const newExecutionId = generateExecutionId();
      const newContext: AgentExecutionContext = {
        ...executionInfo.context,
        executionId: newExecutionId,
        parentExecutionId: executionId,
      };

      // Continue execution
      const result = await executionInfo.agent.continue(continuationContext, newContext);

      // Update execution info
      executionInfo.state = result.state;

      this.log('info', `Continuation ${executionId} completed with state: ${result.state}`);

      return result;
    } catch (error) {
      executionInfo.state = 'failed';

      this.log(
        'error',
        `Continuation ${executionId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      throw error;
    }
  }

  /**
   * Stops a running execution.
   */
  async stopExecution(executionId: string): Promise<void> {
    const executionInfo = this.executions.get(executionId);

    if (!executionInfo) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    this.log('info', `Stopping execution ${executionId}`);

    await executionInfo.agent.stop();
    executionInfo.state = 'cancelled';
  }

  /**
   * Returns the execution state.
   */
  getExecutionStatus(executionId: string): AgentState | null {
    const executionInfo = this.executions.get(executionId);
    return executionInfo?.state ?? null;
  }

  /**
   * Returns all active executions.
   */
  getActiveExecutions(): Array<{
    executionId: string;
    agentId: string;
    state: AgentState;
    startTime: Date;
  }> {
    const activeStates: AgentState[] = ['initializing', 'running', 'waiting_for_input', 'paused'];

    return Array.from(this.executions.values())
      .filter((info) => activeStates.includes(info.state))
      .map((info) => ({
        executionId: info.executionId,
        agentId: info.agentId,
        state: info.state,
        startTime: info.startTime,
      }));
  }

  /**
   * Returns executions for a specific agent.
   */
  getExecutionsByAgent(agentId: string): Array<{
    executionId: string;
    state: AgentState;
    startTime: Date;
  }> {
    const executionIds = this.agentExecutions.get(agentId);

    if (!executionIds) {
      return [];
    }

    return Array.from(executionIds)
      .map((id) => this.executions.get(id))
      .filter((info): info is ExecutionInfo => info !== undefined)
      .map((info) => ({
        executionId: info.executionId,
        state: info.state,
        startTime: info.startTime,
      }));
  }

  /**
   * Returns detailed execution info.
   */
  getExecutionDetails(executionId: string): ExecutionInfo | null {
    return this.executions.get(executionId) ?? null;
  }

  /**
   * Returns the count of active executions.
   */
  getActiveExecutionCount(): number {
    const activeStates: AgentState[] = ['initializing', 'running', 'waiting_for_input', 'paused'];

    return Array.from(this.executions.values()).filter((info) => activeStates.includes(info.state))
      .length;
  }

  /**
   * Stops all active executions.
   */
  async stopAllExecutions(): Promise<void> {
    const activeStates: AgentState[] = ['initializing', 'running', 'waiting_for_input', 'paused'];
    const activeExecutions = Array.from(this.executions.values()).filter((info) =>
      activeStates.includes(info.state),
    );

    this.log('info', `Stopping all ${activeExecutions.length} active executions`);

    await Promise.allSettled(activeExecutions.map((info) => this.stopExecution(info.executionId)));
  }

  /**
   * Cleans up completed executions older than maxAgeMs.
   */
  cleanupOldExecutions(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    const completedStates: AgentState[] = ['completed', 'failed', 'cancelled', 'timeout'];
    let cleanedCount = 0;

    for (const [executionId, info] of this.executions.entries()) {
      const age = now - info.startTime.getTime();
      if (completedStates.includes(info.state) && age > maxAgeMs) {
        this.cleanupExecution(executionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.log('info', `Cleaned up ${cleanedCount} old executions`);
    }

    return cleanedCount;
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private addAgentExecution(agentId: string, executionId: string): void {
    let executionIds = this.agentExecutions.get(agentId);
    if (!executionIds) {
      executionIds = new Set();
      this.agentExecutions.set(agentId, executionIds);
    }
    executionIds.add(executionId);
  }

  private cleanupExecution(executionId: string): void {
    const info = this.executions.get(executionId);
    if (info) {
      const executionIds = this.agentExecutions.get(info.agentId);
      if (executionIds) {
        executionIds.delete(executionId);
        if (executionIds.size === 0) {
          this.agentExecutions.delete(info.agentId);
        }
      }
      this.executions.delete(executionId);
    }
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    if (this.logger) {
      this.logger[level](message);
    } else {
      switch (level) {
        case 'error':
          pinoLog.error(message);
          break;
        case 'warn':
          pinoLog.warn(message);
          break;
        default:
          pinoLog.info(message);
      }
    }
  }
}

/**
 * Default execution manager singleton.
 */
let defaultManager: AgentExecutionManager | null = null;

export function getDefaultExecutionManager(): AgentExecutionManager {
  if (!defaultManager) {
    defaultManager = new AgentExecutionManager();
  }
  return defaultManager;
}

export function setDefaultExecutionManager(manager: AgentExecutionManager): void {
  defaultManager = manager;
}
