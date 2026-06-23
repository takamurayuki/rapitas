/**
 * AgentFactory
 *
 * Creates the appropriate agent instance based on configuration.
 */

import { BaseAgent, AgentCapability } from './base-agent';
import { ClaudeCodeAgent, ClaudeCodeAgentConfig } from './claude-code-agent';
import { GeminiCliAgent, GeminiCliAgentConfig } from './gemini-cli-agent';
import { CodexCliAgent, CodexCliAgentConfig } from './codex-cli-agent';
// NOTE: Direct path import (not barrel) to avoid transitive config/logger pull-in.
import { isOneOf, narrowEnum } from '../../utils/common/type-guards';

/**
 * Runtime array of all valid agent types. Derive AgentType from this
 * so the type and the runtime validation list can never drift apart.
 */
export const AGENT_TYPES = ['claude-code', 'codex', 'gemini', 'custom'] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

/**
 * Type guard: narrows an unknown value to AgentType.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid AgentType. / 有効なAgentTypeの場合true
 */
export function isAgentType(s: unknown): s is AgentType {
  return isOneOf(s, AGENT_TYPES);
}

/**
 * Narrows a DB string (or null/undefined) to AgentType, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'claude-code'`. / 無効時に返す値（既定は'claude-code'）
 * @returns A valid AgentType. / 有効なAgentType
 */
export function narrowAgentType(
  s: string | null | undefined,
  fallback: AgentType = 'claude-code',
): AgentType {
  return narrowEnum(s, AGENT_TYPES, fallback);
}

export type AgentConfigInput = {
  id?: string;
  type: AgentType;
  name: string;
  endpoint?: string;
  apiKey?: string;
  modelId?: string;
  workingDirectory?: string;
  timeout?: number;
  dangerouslySkipPermissions?: boolean;
  continueConversation?: boolean;
  resumeSessionId?: string;
  // Gemini CLI specific settings
  projectId?: string;
  location?: string;
  sandboxMode?: boolean;
  yoloMode?: boolean;
  checkpointId?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  customConfig?: Record<string, unknown>;
  /**
   * Forward investigation-mode flags from ExecutionOptions onto the
   * agent config so claude-code / codex / gemini all honor the
   * read-only contract uniformly.
   */
  investigationMode?: boolean;
  investigationOutputType?: 'research' | 'plan' | 'review' | 'verify';
  outputLastMessageFile?: string;
};

export type RegisteredAgentInfo = {
  type: AgentType;
  name: string;
  description: string;
  capabilities: AgentCapability;
  isAvailable: () => Promise<boolean>;
};

/**
 * AgentFactory
 *
 * Singleton factory for creating and managing agent instances.
 */
export class AgentFactory {
  private static instance: AgentFactory;
  private registeredAgents: Map<AgentType, RegisteredAgentInfo> = new Map();
  private activeAgents: Map<string, BaseAgent> = new Map();
  private nextAgentId: number = 1;

  private constructor() {
    this.registerBuiltinAgents();
  }

  static getInstance(): AgentFactory {
    if (!AgentFactory.instance) {
      AgentFactory.instance = new AgentFactory();
    }
    return AgentFactory.instance;
  }

  /**
   * Register built-in agent types.
   */
  private registerBuiltinAgents(): void {
    this.registeredAgents.set('claude-code', {
      type: 'claude-code',
      name: 'Claude Code',
      description: 'Code generation and editing agent using Claude Code CLI',
      capabilities: {
        codeGeneration: true,
        codeReview: true,
        taskAnalysis: true,
        fileOperations: true,
        terminalAccess: true,
        gitOperations: true,
        webSearch: true,
      },
      isAvailable: async () => {
        const agent = new ClaudeCodeAgent('test', 'test');
        return agent.isAvailable();
      },
    });

    this.registeredAgents.set('codex', {
      type: 'codex',
      name: 'OpenAI Codex CLI',
      description: 'Code generation and editing agent using OpenAI Codex CLI',
      capabilities: {
        codeGeneration: true,
        codeReview: true,
        taskAnalysis: true,
        fileOperations: true,
        terminalAccess: true,
        gitOperations: true,
        webSearch: true,
      },
      isAvailable: async () => {
        const agent = new CodexCliAgent('test', 'test');
        return agent.isAvailable();
      },
    });

    this.registeredAgents.set('gemini', {
      type: 'gemini',
      name: 'Google Gemini CLI',
      description: 'Code generation and editing agent using Google Gemini CLI',
      capabilities: {
        codeGeneration: true,
        codeReview: true,
        taskAnalysis: true,
        fileOperations: true,
        terminalAccess: true,
        gitOperations: true,
        webSearch: true,
      },
      isAvailable: async () => {
        const agent = new GeminiCliAgent('test', 'test');
        return agent.isAvailable();
      },
    });
  }

  /**
   * Create an agent from the given configuration.
   */
  createAgent(config: AgentConfigInput): BaseAgent {
    const id = config.id || `agent-${this.nextAgentId++}`;

    switch (config.type) {
      case 'claude-code': {
        const claudeConfig: ClaudeCodeAgentConfig = {
          workingDirectory: config.workingDirectory,
          model: config.modelId,
          dangerouslySkipPermissions: config.dangerouslySkipPermissions,
          timeout: config.timeout,
          continueConversation: config.continueConversation,
          resumeSessionId: config.resumeSessionId,
          investigationMode: config.investigationMode,
          investigationOutputType: config.investigationOutputType,
        };
        const agent = new ClaudeCodeAgent(id, config.name, claudeConfig);
        this.activeAgents.set(id, agent);
        return agent;
      }

      case 'gemini': {
        const geminiConfig: GeminiCliAgentConfig = {
          workingDirectory: config.workingDirectory,
          model: config.modelId,
          timeout: config.timeout,
          apiKey: config.apiKey,
          projectId: config.projectId,
          location: config.location,
          sandboxMode: config.sandboxMode,
          yolo: config.yoloMode,
          checkpointId: config.checkpointId || config.resumeSessionId,
          allowedTools: config.allowedTools,
          disallowedTools: config.disallowedTools,
        };
        const geminiAgent = new GeminiCliAgent(id, config.name, geminiConfig);
        this.activeAgents.set(id, geminiAgent);
        return geminiAgent;
      }

      case 'codex': {
        const codexConfig: CodexCliAgentConfig = {
          workingDirectory: config.workingDirectory,
          model: config.modelId,
          timeout: config.timeout,
          apiKey: config.apiKey,
          fullAuto: true,
          yolo: config.yoloMode,
          resumeSessionId: config.resumeSessionId,
          sandboxMode: config.sandboxMode ? 'workspace-write' : undefined,
        };
        const codexAgent = new CodexCliAgent(id, config.name, codexConfig);
        this.activeAgents.set(id, codexAgent);
        return codexAgent;
      }

      case 'custom':
        throw new Error('Custom agent type requires a custom implementation');

      default:
        throw new Error(`Unknown agent type: ${config.type}`);
    }
  }

  /**
   * Get an active agent by ID.
   */
  getAgent(id: string): BaseAgent | undefined {
    return this.activeAgents.get(id);
  }

  /**
   * Get all active agents.
   */
  getAllActiveAgents(): Map<string, BaseAgent> {
    return new Map(this.activeAgents);
  }

  /**
   * Remove an agent, stopping it first if running.
   */
  async removeAgent(id: string): Promise<boolean> {
    const agent = this.activeAgents.get(id);
    if (agent) {
      if (agent.getStatus() === 'running') {
        await agent.stop();
      }
      this.activeAgents.delete(id);
      return true;
    }
    return false;
  }

  /**
   * Get all registered agent types.
   */
  getRegisteredAgents(): RegisteredAgentInfo[] {
    return Array.from(this.registeredAgents.values());
  }

  /**
   * Get agent types that are currently available.
   */
  async getAvailableAgents(): Promise<RegisteredAgentInfo[]> {
    const available: RegisteredAgentInfo[] = [];
    for (const info of this.registeredAgents.values()) {
      if (await info.isAvailable()) {
        available.push(info);
      }
    }
    return available;
  }

  /**
   * Get agent types that have a specific capability.
   */
  getAgentsByCapability(capability: keyof AgentCapability): RegisteredAgentInfo[] {
    return Array.from(this.registeredAgents.values()).filter(
      (info) => info.capabilities[capability],
    );
  }

  /**
   * Create a default Claude Code agent.
   */
  createDefaultAgent(workingDirectory?: string): BaseAgent {
    return this.createAgent({
      type: 'claude-code',
      name: 'Default Claude Code Agent',
      workingDirectory,
    });
  }
}

export const agentFactory = AgentFactory.getInstance();
