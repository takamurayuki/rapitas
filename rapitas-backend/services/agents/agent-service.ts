/**
 * AgentService
 *
 * Unified facade for managing and using multiple AI providers.
 */

import { createLogger } from '../../config/logger';
import { getProjectRoot } from '../../config';

const log = createLogger('agent-service');

import type {
  AgentProviderId,
  AgentCapabilities,
  AgentProviderConfig,
  AgentHealthStatus,
  AgentExecutionContext,
  AgentTaskDefinition,
  AgentExecutionResult,
  ContinuationContext,
  AgentState,
  StateChangeEvent,
} from './abstraction/types';
import type { IAgentProvider, IAgent, ProviderInfo } from './abstraction/interfaces';
import { AgentRegistry, agentRegistry, generateExecutionId, isTerminalState } from './abstraction';

/**
 * Agent execution options.
 */
export interface ExecuteOptions {
  workingDirectory: string;
  timeout?: number;
  autoApprove?: boolean;
  verbose?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Criteria for selecting a provider.
 */
export interface ProviderSelectionCriteria {
  providerId?: AgentProviderId;
  requiredCapabilities?: Array<keyof AgentCapabilities>;
  preferredModel?: string;
}

/**
 * Agent service configuration.
 */
export interface AgentServiceConfig {
  defaultProviderId: AgentProviderId;
  defaultTimeout: number;
  autoRegisterProviders: boolean;
  enableMetrics: boolean;
}

/**
 * Active agent execution info.
 */
export interface ActiveExecution {
  executionId: string;
  agentId: string;
  providerId: AgentProviderId;
  state: AgentState;
  startTime: Date;
  task: AgentTaskDefinition;
}

/**
 * Unified AI agent service.
 * Singleton that manages multiple providers through a unified interface.
 */
export class AgentService {
  private static instance: AgentService;
  private registry: AgentRegistry;
  private config: AgentServiceConfig;
  private activeExecutions: Map<string, ActiveExecution> = new Map();
  private initialized = false;

  private constructor(config?: Partial<AgentServiceConfig>) {
    this.registry = agentRegistry;
    this.config = {
      defaultProviderId: 'claude-code',
      defaultTimeout: 900000, // 15 minutes
      autoRegisterProviders: true,
      enableMetrics: true,
      ...config,
    };
  }

  /**
   * Get the singleton instance.
   */
  static getInstance(config?: Partial<AgentServiceConfig>): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService(config);
    }
    return AgentService.instance;
  }

  /**
   * Reset the singleton instance (for testing).
   */
  static resetInstance(): void {
    if (AgentService.instance) {
      AgentService.instance.activeExecutions.clear();
    }
    AgentService.instance = undefined as unknown as AgentService;
  }

  /**
   * Initialize the service.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.config.autoRegisterProviders) {
      const { registerDefaultProviders } = await import('./providers');
      registerDefaultProviders();
    }

    this.initialized = true;
    log.info('AgentService initialized');
  }

  /**
   * Register a provider.
   */
  registerProvider(provider: IAgentProvider): void {
    this.registry.registerProvider(provider);
  }

  /**
   * Get available providers.
   */
  async getAvailableProviders(): Promise<ProviderInfo[]> {
    return this.registry.getAvailableProviders();
  }

  /**
   * Get a specific provider.
   */
  getProvider(providerId: AgentProviderId): IAgentProvider | undefined {
    return this.registry.getProvider(providerId);
  }

  /**
   * Get providers that have a specific capability.
   */
  getProvidersByCapability(capability: keyof AgentCapabilities): IAgentProvider[] {
    return this.registry.getProvidersByCapability(capability);
  }

  /**
   * Select the best provider based on criteria.
   */
  async selectProvider(criteria: ProviderSelectionCriteria): Promise<IAgentProvider | null> {
    if (criteria.providerId) {
      const provider = this.registry.getProvider(criteria.providerId);
      if (provider) {
        const available = await provider.isAvailable();
        if (available) {
          return provider;
        }
      }
      return null;
    }

    if (criteria.requiredCapabilities && criteria.requiredCapabilities.length > 0) {
      return this.registry.selectBestProvider(criteria.requiredCapabilities);
    }

    return this.registry.getProvider(this.config.defaultProviderId) || null;
  }

  /**
   * Execute a task.
   */
  async executeTask(
    task: AgentTaskDefinition,
    options: ExecuteOptions,
    criteria?: ProviderSelectionCriteria,
  ): Promise<AgentExecutionResult> {
    await this.ensureInitialized();

    const provider = await this.selectProvider(criteria || {});
    if (!provider) {
      return {
        success: false,
        state: 'failed',
        output: '',
        errorMessage: 'No available provider found',
      };
    }

    const config: AgentProviderConfig = {
      providerId: provider.providerId,
      enabled: true,
    };

    const agent = this.registry.createAgent(config);
    const executionId = generateExecutionId();

    const context: AgentExecutionContext = {
      executionId,
      workingDirectory: options.workingDirectory,
      timeout: options.timeout || this.config.defaultTimeout,
      autoApprove: options.autoApprove,
      verbose: options.verbose,
      metadata: options.metadata,
    };

    this.activeExecutions.set(executionId, {
      executionId,
      agentId: agent.metadata.id,
      providerId: provider.providerId,
      state: 'initializing',
      startTime: new Date(),
      task,
    });

    const unsubscribe = agent.events.on<StateChangeEvent>('state_change', (event) => {
      const execution = this.activeExecutions.get(executionId);
      if (execution) {
        execution.state = event.newState;
      }
    });

    try {
      const result = await agent.execute(task, context);

      if (isTerminalState(result.state)) {
        this.activeExecutions.delete(executionId);
      }

      return result;
    } finally {
      unsubscribe();

      if (isTerminalState(agent.state)) {
        await this.registry.disposeAgent(agent.metadata.id);
      }
    }
  }

  /**
   * Continue execution (e.g., after answering a question).
   */
  async continueExecution(
    executionId: string,
    userResponse: string,
    previousSessionId?: string,
  ): Promise<AgentExecutionResult> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      return {
        success: false,
        state: 'failed',
        output: '',
        errorMessage: `Execution ${executionId} not found`,
      };
    }

    const agent = this.registry.getAgent(execution.agentId);
    if (!agent) {
      return {
        success: false,
        state: 'failed',
        output: '',
        errorMessage: `Agent ${execution.agentId} not found`,
      };
    }

    const continuation: ContinuationContext = {
      sessionId: previousSessionId || executionId,
      previousExecutionId: executionId,
      userResponse,
    };

    const context: AgentExecutionContext = {
      executionId,
      workingDirectory: execution.task.constraints?.allowedPaths?.[0] || getProjectRoot(),
    };

    const result = await agent.continue(continuation, context);

    if (isTerminalState(result.state)) {
      this.activeExecutions.delete(executionId);
      await this.registry.disposeAgent(execution.agentId);
    }

    return result;
  }

  /**
   * Stop an execution.
   */
  async stopExecution(executionId: string): Promise<boolean> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      return false;
    }

    const agent = this.registry.getAgent(execution.agentId);
    if (!agent) {
      return false;
    }

    await agent.stop();
    this.activeExecutions.delete(executionId);
    await this.registry.disposeAgent(execution.agentId);

    return true;
  }

  /**
   * Get all active executions.
   */
  getActiveExecutions(): ActiveExecution[] {
    return Array.from(this.activeExecutions.values());
  }

  /**
   * Get execution status by ID.
   */
  getExecutionStatus(executionId: string): ActiveExecution | null {
    return this.activeExecutions.get(executionId) || null;
  }

  /**
   * Health check all providers.
   */
  async healthCheckAll(): Promise<Map<AgentProviderId, AgentHealthStatus>> {
    return this.registry.healthCheckAll();
  }

  /**
   * Health check a specific provider.
   */
  async healthCheck(providerId: AgentProviderId): Promise<AgentHealthStatus | null> {
    const provider = this.registry.getProvider(providerId);
    if (!provider) {
      return null;
    }
    return provider.healthCheck();
  }

  /**
   * Get service statistics.
   */
  getStats(): {
    initialized: boolean;
    providerCount: number;
    activeExecutions: number;
    registryStats: ReturnType<AgentRegistry['getStats']>;
  } {
    return {
      initialized: this.initialized,
      providerCount: this.registry.getAllProviders().length,
      activeExecutions: this.activeExecutions.size,
      registryStats: this.registry.getStats(),
    };
  }

  /**
   * Release all resources.
   */
  async shutdown(): Promise<void> {
    for (const [executionId] of this.activeExecutions) {
      await this.stopExecution(executionId);
    }

    await this.registry.disposeAllAgents();

    this.initialized = false;
    log.info('AgentService shut down');
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

/**
 * Default AgentService instance.
 */
export const agentService = AgentService.getInstance();

/**
 * Convenience helper for executing a task with an agent.
 */
export async function executeWithAgent(
  task: AgentTaskDefinition,
  options: ExecuteOptions,
  providerId?: AgentProviderId,
): Promise<AgentExecutionResult> {
  return agentService.executeTask(task, options, providerId ? { providerId } : undefined);
}

/**
 * Convenience helper for continuing an agent execution.
 */
export async function continueWithAgent(
  executionId: string,
  userResponse: string,
): Promise<AgentExecutionResult> {
  return agentService.continueExecution(executionId, userResponse);
}
