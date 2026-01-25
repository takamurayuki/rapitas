/**
 * エージェントファクトリー
 * 設定に基づいて適切なエージェントインスタンスを生成
 */

import { BaseAgent, AgentCapability } from './base-agent';
import { ClaudeCodeAgent, ClaudeCodeAgentConfig } from './claude-code-agent';

export type AgentType = 'claude-code' | 'codex' | 'gemini' | 'custom';

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
  continueConversation?: boolean; // 前回の会話を継続するか
  customConfig?: Record<string, unknown>;
};

export type RegisteredAgentInfo = {
  type: AgentType;
  name: string;
  description: string;
  capabilities: AgentCapability;
  isAvailable: () => Promise<boolean>;
};

/**
 * エージェントファクトリークラス
 */
export class AgentFactory {
  private static instance: AgentFactory;
  private registeredAgents: Map<AgentType, RegisteredAgentInfo> = new Map();
  private activeAgents: Map<string, BaseAgent> = new Map();
  private nextAgentId: number = 1;

  private constructor() {
    // 組み込みエージェントを登録
    this.registerBuiltinAgents();
  }

  static getInstance(): AgentFactory {
    if (!AgentFactory.instance) {
      AgentFactory.instance = new AgentFactory();
    }
    return AgentFactory.instance;
  }

  /**
   * 組み込みエージェントを登録
   */
  private registerBuiltinAgents(): void {
    // Claude Code
    this.registeredAgents.set('claude-code', {
      type: 'claude-code',
      name: 'Claude Code',
      description: 'Claude Code CLI を使用したコード生成・編集エージェント',
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

    // Future: Codex
    this.registeredAgents.set('codex', {
      type: 'codex',
      name: 'OpenAI Codex',
      description: 'OpenAI Codex を使用したコード生成エージェント（未実装）',
      capabilities: {
        codeGeneration: true,
        codeReview: false,
        taskAnalysis: true,
        fileOperations: false,
        terminalAccess: false,
      },
      isAvailable: async () => false, // 未実装
    });

    // Future: Gemini
    this.registeredAgents.set('gemini', {
      type: 'gemini',
      name: 'Google Gemini',
      description: 'Google Gemini を使用したコード生成エージェント（未実装）',
      capabilities: {
        codeGeneration: true,
        codeReview: true,
        taskAnalysis: true,
        fileOperations: false,
        terminalAccess: false,
      },
      isAvailable: async () => false, // 未実装
    });
  }

  /**
   * エージェントを作成
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
        };
        const agent = new ClaudeCodeAgent(id, config.name, claudeConfig);
        this.activeAgents.set(id, agent);
        return agent;
      }

      case 'codex':
      case 'gemini':
        throw new Error(`Agent type '${config.type}' is not yet implemented`);

      case 'custom':
        throw new Error('Custom agent type requires a custom implementation');

      default:
        throw new Error(`Unknown agent type: ${config.type}`);
    }
  }

  /**
   * アクティブなエージェントを取得
   */
  getAgent(id: string): BaseAgent | undefined {
    return this.activeAgents.get(id);
  }

  /**
   * アクティブなエージェントを全て取得
   */
  getAllActiveAgents(): Map<string, BaseAgent> {
    return new Map(this.activeAgents);
  }

  /**
   * エージェントを削除
   */
  async removeAgent(id: string): Promise<boolean> {
    const agent = this.activeAgents.get(id);
    if (agent) {
      // 実行中の場合は停止
      if (agent.getStatus() === 'running') {
        await agent.stop();
      }
      this.activeAgents.delete(id);
      return true;
    }
    return false;
  }

  /**
   * 登録済みエージェントタイプを取得
   */
  getRegisteredAgents(): RegisteredAgentInfo[] {
    return Array.from(this.registeredAgents.values());
  }

  /**
   * 利用可能なエージェントタイプを取得
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
   * 特定の能力を持つエージェントタイプを取得
   */
  getAgentsByCapability(capability: keyof AgentCapability): RegisteredAgentInfo[] {
    return Array.from(this.registeredAgents.values()).filter(
      (info) => info.capabilities[capability]
    );
  }

  /**
   * デフォルトエージェントを作成（Claude Code）
   */
  createDefaultAgent(workingDirectory?: string): BaseAgent {
    return this.createAgent({
      type: 'claude-code',
      name: 'Default Claude Code Agent',
      workingDirectory,
    });
  }
}

// シングルトンインスタンスをエクスポート
export const agentFactory = AgentFactory.getInstance();
