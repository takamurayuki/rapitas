/**
 * エージェントファクトリー
 * 設定に基づいて適切なエージェントインスタンスを生成
 */

import { BaseAgent, AgentCapability } from './base-agent';
import { ClaudeCodeAgent, ClaudeCodeAgentConfig } from './claude-code-agent';
import { GeminiCliAgent, GeminiCliAgentConfig } from './gemini-cli-agent';
import { CodexCliAgent, CodexCliAgentConfig } from './codex-cli-agent';

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
  continueConversation?: boolean; // 前回の会話を継続するか（--continue）
  resumeSessionId?: string; // --resumeで使用するセッションID
  // Gemini CLI 固有の設定
  projectId?: string; // Google Cloud Project ID
  location?: string; // Google Cloud region
  sandboxMode?: boolean; // サンドボックスモードで実行
  yoloMode?: boolean; // 自動承認モード（Gemini CLI --yolo）
  checkpointId?: string; // チェックポイントIDでセッション継続
  allowedTools?: string[]; // 許可するツール
  disallowedTools?: string[]; // 禁止するツール
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

    // Codex CLI
    this.registeredAgents.set('codex', {
      type: 'codex',
      name: 'OpenAI Codex CLI',
      description: 'OpenAI Codex CLI を使用したコード生成・編集エージェント',
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

    // Gemini CLI
    this.registeredAgents.set('gemini', {
      type: 'gemini',
      name: 'Google Gemini CLI',
      description: 'Google Gemini CLI を使用したコード生成・編集エージェント',
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
          resumeSessionId: config.resumeSessionId,
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
          fullAuto: true, // 自動実行モードはデフォルトで有効
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
