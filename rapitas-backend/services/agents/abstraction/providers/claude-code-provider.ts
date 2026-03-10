/**
 * Claude Code Provider
 * Claude Code CLIを使用するエージェントプロバイダー
 */

import type {
  AgentProviderId,
  AgentCapabilities,
  AgentProviderConfig,
  ClaudeCodeProviderConfig,
  AgentHealthStatus,
} from '../types';
import type { IAgentProvider, IAgent } from '../interfaces';
import { createDefaultCapabilities } from '../index';
import { ClaudeCodeAgentAdapter } from './claude-code-agent-adapter';

function resolveCliPath(cliName: string): string {
  if (process.platform !== 'win32') return cliName;
  try {
    const { execSync } = require('child_process');
    const { existsSync } = require('fs');
    const resolved = execSync(`where ${cliName}`, {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    })
      .trim()
      .split(/\r?\n/)[0];
    if (resolved && existsSync(resolved)) {
      return resolved;
    }
  } catch {
    // フォールバック
  }
  return cliName;
}

/**
 * Claude Code Provider
 * Claude Code CLIを使用したエージェントを提供
 */
export class ClaudeCodeProvider implements IAgentProvider {
  readonly providerId: AgentProviderId = 'claude-code';
  readonly providerName = 'Claude Code';
  readonly version = '1.0.0';

  private capabilities: AgentCapabilities;
  private defaultConfig: Partial<ClaudeCodeProviderConfig>;

  constructor(config?: Partial<ClaudeCodeProviderConfig>) {
    this.defaultConfig = config || {};

    // Claude Code CLIの能力を設定
    this.capabilities = createDefaultCapabilities({
      codeGeneration: true,
      codeReview: true,
      codeExecution: true,
      fileRead: true,
      fileWrite: true,
      fileEdit: true,
      terminalAccess: true,
      gitOperations: true,
      webSearch: true,
      webFetch: true,
      taskAnalysis: true,
      taskPlanning: true,
      parallelExecution: false, // 単一エージェントとしては並列実行しない
      questionAsking: true,
      conversationMemory: true,
      sessionContinuation: true,
    });
  }

  /**
   * プロバイダーの能力を取得
   */
  getCapabilities(): AgentCapabilities {
    return { ...this.capabilities };
  }

  /**
   * プロバイダーが利用可能かチェック
   */
  async isAvailable(): Promise<boolean> {
    try {
      const { spawn } = await import('child_process');

      return new Promise((resolve) => {
        const isWindows = process.platform === 'win32';
        const claudePath = resolveCliPath(
          process.env.CLAUDE_CODE_PATH || (isWindows ? 'claude.cmd' : 'claude'),
        );

        const proc = spawn(claudePath, ['--version'], { shell: true });

        const timeout = setTimeout(() => {
          proc.kill();
          resolve(false);
        }, 10000);

        proc.on('close', (code) => {
          clearTimeout(timeout);
          resolve(code === 0);
        });

        proc.on('error', () => {
          clearTimeout(timeout);
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }

  /**
   * 設定を検証
   */
  async validateConfig(config: AgentProviderConfig): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // プロバイダーIDの確認
    if (config.providerId !== 'claude-code') {
      errors.push(`Invalid provider ID: expected 'claude-code', got '${config.providerId}'`);
    }

    // Claude CLIが利用可能かチェック
    const available = await this.isAvailable();
    if (!available) {
      errors.push('Claude Code CLI is not installed or not available in PATH');
    }

    // Claude Code固有の設定を検証
    const claudeConfig = config as ClaudeCodeProviderConfig;

    // cliPathが指定されている場合、存在チェック
    if (claudeConfig.cliPath) {
      try {
        const fs = await import('fs/promises');
        await fs.access(claudeConfig.cliPath);
      } catch {
        errors.push(`Specified CLI path does not exist: ${claudeConfig.cliPath}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * ヘルスチェック
   */
  async healthCheck(): Promise<AgentHealthStatus> {
    const startTime = Date.now();
    const errors: string[] = [];

    try {
      const isAvailable = await this.isAvailable();
      const latency = Date.now() - startTime;

      if (!isAvailable) {
        errors.push('Claude Code CLI is not available');
      }

      return {
        healthy: isAvailable,
        available: isAvailable,
        latency,
        errors: errors.length > 0 ? errors : undefined,
        lastCheck: new Date(),
        details: {
          platform: process.platform,
          cliPath:
            process.env.CLAUDE_CODE_PATH ||
            (process.platform === 'win32' ? 'claude.cmd' : 'claude'),
        },
      };
    } catch (error) {
      return {
        healthy: false,
        available: false,
        latency: Date.now() - startTime,
        errors: [error instanceof Error ? error.message : String(error)],
        lastCheck: new Date(),
      };
    }
  }

  /**
   * エージェントインスタンスを作成
   */
  createAgent(config: AgentProviderConfig): IAgent {
    const claudeConfig = config as ClaudeCodeProviderConfig;

    // デフォルト設定とマージ
    const mergedConfig: ClaudeCodeProviderConfig = {
      ...this.defaultConfig,
      ...claudeConfig,
    };

    return new ClaudeCodeAgentAdapter(mergedConfig);
  }
}

/**
 * デフォルトのClaude Code Providerインスタンス
 */
export const claudeCodeProvider = new ClaudeCodeProvider();
