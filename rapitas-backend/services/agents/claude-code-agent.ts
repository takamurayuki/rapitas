/**
 * Claude Code CLI エージェント
 * Claude Code CLIを子プロセスとして起動し、タスクを実行する
 */

import { spawn, ChildProcess } from 'child_process';
import {
  BaseAgent,
  AgentCapability,
  AgentTask,
  AgentExecutionResult,
  AgentArtifact,
  GitCommitInfo,
} from './base-agent';

export type ClaudeCodeAgentConfig = {
  workingDirectory?: string;
  model?: string;
  dangerouslySkipPermissions?: boolean;
  timeout?: number; // milliseconds
  maxTokens?: number;
};

export class ClaudeCodeAgent extends BaseAgent {
  private process: ChildProcess | null = null;
  private config: ClaudeCodeAgentConfig;
  private outputBuffer: string = '';
  private errorBuffer: string = '';

  constructor(id: string, name: string, config: ClaudeCodeAgentConfig = {}) {
    super(id, name, 'claude-code');
    this.config = {
      timeout: 300000, // 5 minutes default
      ...config,
    };
  }

  getCapabilities(): AgentCapability {
    return {
      codeGeneration: true,
      codeReview: true,
      taskAnalysis: true,
      fileOperations: true,
      terminalAccess: true,
      gitOperations: true,
      webSearch: true,
    };
  }

  async execute(task: AgentTask, options?: Record<string, unknown>): Promise<AgentExecutionResult> {
    this.status = 'running';
    this.outputBuffer = '';
    this.errorBuffer = '';
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const workDir = task.workingDirectory || this.config.workingDirectory || process.cwd();

      // Claude Code CLI コマンドを構築
      // 実行モードに応じてフラグを設定
      const args: string[] = [];

      // 自動実行モード: 実際にファイル変更を行う
      if (this.config.dangerouslySkipPermissions) {
        args.push('--dangerously-skip-permissions');
      }

      // モデル指定
      if (this.config.model) {
        args.push('--model', this.config.model);
      }

      // 最大トークン数
      if (this.config.maxTokens) {
        args.push('--max-tokens', String(this.config.maxTokens));
      }

      // プロンプトを追加（-p フラグで非対話モード）
      args.push('-p', task.description || task.title);

      // Windows環境でのClaudeコマンドのパス
      const claudePath = process.platform === 'win32'
        ? 'C:\\home\\wsl\\.npm-global\\claude.cmd'
        : 'claude';

      this.emitOutput(`[Claude Code] Starting execution in ${workDir}\n`);
      this.emitOutput(`[Claude Code] Task: ${task.title}\n`);
      this.emitOutput(`[Claude Code] Command: ${claudePath} ${args.join(' ')}\n\n`);

      try {
        this.process = spawn(claudePath, args, {
          cwd: workDir,
          shell: true,
          env: {
            ...process.env,
            FORCE_COLOR: '0', // Disable colored output for easier parsing
          },
        });

        // タイムアウト設定
        const timeoutId = setTimeout(() => {
          if (this.process) {
            this.emitOutput('\n[Claude Code] Execution timed out\n', true);
            this.process.kill('SIGTERM');
            this.status = 'failed';
            resolve({
              success: false,
              output: this.outputBuffer,
              errorMessage: 'Execution timed out',
              executionTimeMs: Date.now() - startTime,
            });
          }
        }, this.config.timeout);

        this.process.stdout?.on('data', (data: Buffer) => {
          const output = data.toString();
          this.outputBuffer += output;
          this.emitOutput(output);
        });

        this.process.stderr?.on('data', (data: Buffer) => {
          const output = data.toString();
          this.errorBuffer += output;
          this.emitOutput(output, true);
        });

        this.process.on('close', (code: number | null) => {
          clearTimeout(timeoutId);
          const executionTimeMs = Date.now() - startTime;

          if (this.status === 'cancelled') {
            resolve({
              success: false,
              output: this.outputBuffer,
              errorMessage: 'Execution cancelled',
              executionTimeMs,
            });
            return;
          }

          this.status = code === 0 ? 'completed' : 'failed';

          // 成果物を解析
          const artifacts = this.parseArtifacts(this.outputBuffer);
          const commits = this.parseCommits(this.outputBuffer);

          resolve({
            success: code === 0,
            output: this.outputBuffer,
            artifacts,
            commits,
            executionTimeMs,
            errorMessage: code !== 0 ? this.errorBuffer || `Process exited with code ${code}` : undefined,
          });
        });

        this.process.on('error', (error: Error) => {
          clearTimeout(timeoutId);
          this.status = 'failed';
          this.emitOutput(`[Claude Code] Error: ${error.message}\n`, true);
          resolve({
            success: false,
            output: this.outputBuffer,
            errorMessage: error.message,
            executionTimeMs: Date.now() - startTime,
          });
        });
      } catch (error) {
        this.status = 'failed';
        const errorMessage = error instanceof Error ? error.message : String(error);
        resolve({
          success: false,
          output: '',
          errorMessage,
          executionTimeMs: Date.now() - startTime,
        });
      }
    });
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.status = 'cancelled';
      this.emitOutput('\n[Claude Code] Stopping execution...\n');

      // まずSIGINTを送信して丁寧に終了を試みる
      this.process.kill('SIGINT');

      // 5秒後にまだ動いていればSIGTERMを送信
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.process || this.process.killed) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);

        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGTERM');
          }
          clearInterval(checkInterval);
          resolve();
        }, 5000);
      });

      this.process = null;
    }
  }

  async pause(): Promise<boolean> {
    if (this.process && this.status === 'running') {
      this.process.kill('SIGSTOP');
      this.status = 'paused';
      this.emitOutput('\n[Claude Code] Execution paused\n');
      return true;
    }
    return false;
  }

  async resume(): Promise<boolean> {
    if (this.process && this.status === 'paused') {
      this.process.kill('SIGCONT');
      this.status = 'running';
      this.emitOutput('\n[Claude Code] Execution resumed\n');
      return true;
    }
    return false;
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const claudePath = process.platform === 'win32'
        ? 'C:\\home\\wsl\\.npm-global\\claude.cmd'
        : 'claude';
      const proc = spawn(claudePath, ['--version'], { shell: true });
      proc.on('close', (code) => {
        resolve(code === 0);
      });
      proc.on('error', () => {
        resolve(false);
      });
    });
  }

  async validateConfig(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Claude CLIが利用可能か確認
    const available = await this.isAvailable();
    if (!available) {
      errors.push('Claude Code CLI is not installed or not available in PATH');
    }

    // 作業ディレクトリの検証
    if (this.config.workingDirectory) {
      try {
        const fs = await import('fs/promises');
        const stats = await fs.stat(this.config.workingDirectory);
        if (!stats.isDirectory()) {
          errors.push(`Working directory is not a directory: ${this.config.workingDirectory}`);
        }
      } catch {
        errors.push(`Working directory does not exist: ${this.config.workingDirectory}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 出力からファイル変更などの成果物を解析
   */
  private parseArtifacts(output: string): AgentArtifact[] {
    const artifacts: AgentArtifact[] = [];

    // ファイル作成/編集のパターンを検出
    const filePatterns = [
      /(?:Created|Modified|Wrote to|Writing to)[:\s]+([^\n]+)/gi,
      /File: ([^\n]+)/gi,
    ];

    for (const pattern of filePatterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        const filePath = match[1].trim();
        if (filePath && !filePath.includes('...')) {
          artifacts.push({
            type: 'file',
            name: filePath.split('/').pop() || filePath,
            content: '', // 実際のコンテンツは後で取得
            path: filePath,
          });
        }
      }
    }

    // diff出力を検出
    const diffPattern = /```diff\n([\s\S]*?)```/g;
    let diffMatch;
    while ((diffMatch = diffPattern.exec(output)) !== null) {
      artifacts.push({
        type: 'diff',
        name: 'changes.diff',
        content: diffMatch[1],
      });
    }

    return artifacts;
  }

  /**
   * 出力からGitコミット情報を解析
   */
  private parseCommits(output: string): GitCommitInfo[] {
    const commits: GitCommitInfo[] = [];

    // コミットハッシュのパターンを検出
    const commitPattern = /(?:Committed|commit)\s+([a-f0-9]{7,40})/gi;
    let match;
    while ((match = commitPattern.exec(output)) !== null) {
      commits.push({
        hash: match[1],
        message: '', // 詳細はgit logから取得する必要あり
        branch: '',
        filesChanged: 0,
        additions: 0,
        deletions: 0,
      });
    }

    return commits;
  }
}
