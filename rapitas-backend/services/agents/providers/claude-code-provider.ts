/**
 * Claude Code プロバイダー
 * 新しい抽象化レイヤーに対応したClaude Codeエージェントプロバイダー
 */

import { spawn } from 'child_process';
import type {
  AgentCapabilities,
  AgentProviderConfig,
  ClaudeCodeProviderConfig,
  AgentHealthStatus,
  AgentExecutionContext,
  AgentTaskDefinition,
  AgentExecutionResult,
  ContinuationContext,
} from '../abstraction/types';
import type { IAgentProvider, IAgent } from '../abstraction/interfaces';
import { AbstractAgent } from '../abstraction/abstract-agent';
import { createAgentEventEmitter } from '../abstraction/event-emitter';
import { generateAgentId } from '../abstraction';

/**
 * Claude Code プロバイダー設定
 */
export interface ClaudeCodeConfig extends ClaudeCodeProviderConfig {
  workingDirectory?: string;
  model?: string;
  timeout?: number;
  maxTokens?: number;
  continueConversation?: boolean;
  resumeSessionId?: string;
}

/**
 * Claude Code エージェント（新抽象化レイヤー対応版）
 */
export class ClaudeCodeAgentV2 extends AbstractAgent {
  private config: ClaudeCodeConfig;
  private process: import('child_process').ChildProcess | null = null;
  private outputBuffer = '';
  private errorBuffer = '';
  private lineBuffer = '';
  private claudeSessionId: string | null = null;

  constructor(config: ClaudeCodeConfig) {
    super(
      generateAgentId('claude-code'),
      config.defaultModel || 'Claude Code Agent',
      'claude-code',
      {
        version: '2.0.0',
        description: 'Claude Code CLI を使用したコード生成・編集エージェント',
        modelId: config.defaultModel,
      },
    );
    this.config = config;
  }

  get capabilities(): AgentCapabilities {
    return {
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
      parallelExecution: false,
      questionAsking: true,
      conversationMemory: true,
      sessionContinuation: true,
    };
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      const claudePath =
        this.config.cliPath ||
        process.env.CLAUDE_CODE_PATH ||
        (isWindows ? 'claude.cmd' : 'claude');

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
  }

  async validateConfig(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    const available = await this.isAvailable();
    if (!available) {
      errors.push('Claude Code CLI is not installed or not available in PATH');
    }

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

    return { valid: errors.length === 0, errors };
  }

  protected async doExecute(
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    this.outputBuffer = '';
    this.errorBuffer = '';
    this.lineBuffer = '';
    this.claudeSessionId = null;

    const prompt = this.buildPrompt(task);
    const workDir = context.workingDirectory || this.config.workingDirectory || process.cwd();

    return this.runClaudeCode(prompt, workDir, context);
  }

  protected async doContinue(
    continuation: ContinuationContext,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    this.outputBuffer = '';
    this.errorBuffer = '';
    this.lineBuffer = '';

    const prompt = continuation.userResponse || '';
    const workDir = context.workingDirectory || this.config.workingDirectory || process.cwd();

    // 継続実行フラグを設定
    const originalContinue = this.config.continueConversation;
    this.config.continueConversation = true;
    this.config.resumeSessionId = continuation.sessionId;

    try {
      return await this.runClaudeCode(prompt, workDir, context);
    } finally {
      this.config.continueConversation = originalContinue;
    }
  }

  protected async doStop(): Promise<void> {
    if (this.process) {
      const isWindows = process.platform === 'win32';

      if (isWindows) {
        try {
          const pid = this.process.pid;
          if (pid) {
            const { execSync } = require('child_process');
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
          }
        } catch {
          try {
            this.process.kill();
          } catch {}
        }
      } else {
        this.process.kill('SIGTERM');
      }

      this.process = null;
    }
  }

  private buildPrompt(task: AgentTaskDefinition): string {
    if (task.optimizedPrompt) {
      return task.optimizedPrompt;
    }

    if (task.analysis) {
      return this.buildStructuredPrompt(task);
    }

    return task.prompt || task.description || task.title;
  }

  private buildStructuredPrompt(task: AgentTaskDefinition): string {
    const analysis = task.analysis!;
    const sections: string[] = [];

    sections.push('# タスク実装指示');
    sections.push('');
    sections.push('## 概要');
    sections.push(`**タスク名:** ${task.title}`);
    sections.push(`**分析サマリー:** ${analysis.summary}`);
    sections.push(`**複雑度:** ${analysis.complexity}`);
    if (analysis.estimatedDuration) {
      sections.push(`**推定時間:** ${analysis.estimatedDuration}分`);
    }
    sections.push('');

    if (task.description) {
      sections.push('## タスク詳細');
      sections.push(task.description);
      sections.push('');
    }

    if (analysis.subtasks && analysis.subtasks.length > 0) {
      sections.push('## 実装手順');
      for (const subtask of analysis.subtasks) {
        sections.push(`### ${subtask.order}. ${subtask.title}`);
        sections.push(`- **説明:** ${subtask.description}`);
        if (subtask.estimatedDuration) {
          sections.push(`- **推定時間:** ${subtask.estimatedDuration}分`);
        }
        sections.push(`- **優先度:** ${subtask.priority}`);
        sections.push('');
      }
    }

    if (analysis.tips && analysis.tips.length > 0) {
      sections.push('## 実装のヒント');
      for (const tip of analysis.tips) {
        sections.push(`- ${tip}`);
      }
      sections.push('');
    }

    return sections.join('\n');
  }

  private async runClaudeCode(
    prompt: string,
    workDir: string,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const timeout = context.timeout || this.config.timeout || 900000;
      const isWindows = process.platform === 'win32';
      const claudePath =
        this.config.cliPath ||
        process.env.CLAUDE_CODE_PATH ||
        (isWindows ? 'claude.cmd' : 'claude');

      const args: string[] = ['--print', '--verbose', '--output-format', 'stream-json'];

      if (this.config.resumeSessionId) {
        // セッションIDが指定されている場合は --resume で正確にそのセッションを再開
        args.push('--resume', this.config.resumeSessionId);
      } else if (this.config.continueConversation) {
        // セッションIDがない場合は --continue で最新の会話を継続
        args.push('--continue');
      }

      if (this.config.dangerouslySkipPermissions || context.dangerouslySkipPermissions) {
        args.push('--dangerously-skip-permissions');
      }

      if (this.config.model) {
        args.push('--model', this.config.model);
      }

      if (this.config.maxTokens) {
        args.push('--max-tokens', String(this.config.maxTokens));
      }

      let finalCommand: string;
      let finalArgs: string[];

      if (isWindows) {
        const argsString = args.join(' ');
        finalCommand = `chcp 65001 >NUL 2>&1 && ${claudePath} ${argsString}`;
        finalArgs = [];
      } else {
        finalCommand = claudePath;
        finalArgs = args;
      }

      this.log('info', `Starting Claude Code execution`, { workDir, promptLength: prompt.length });

      try {
        this.process = spawn(finalCommand, finalArgs, {
          cwd: workDir,
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            FORCE_COLOR: '0',
            NO_COLOR: '1',
            CI: '1',
            TERM: 'dumb',
          },
        });

        if (this.process.stdout) {
          this.process.stdout.setEncoding('utf8');
        }
        if (this.process.stderr) {
          this.process.stderr.setEncoding('utf8');
        }

        // プロンプトを書き込み
        this.writePromptToStdin(prompt);

        let lastOutputTime = Date.now();
        let hasDetectedQuestion = false;
        let detectedQuestionText = '';

        // タイムアウト監視
        const timeoutCheck = setInterval(() => {
          if (Date.now() - lastOutputTime >= timeout) {
            clearInterval(timeoutCheck);
            if (this.process && !this.process.killed) {
              this.process.kill('SIGTERM');
            }
            resolve({
              success: false,
              state: 'timeout',
              output: this.outputBuffer,
              errorMessage: `Execution timed out (no output for ${timeout / 1000}s)`,
              metrics: {
                startTime: new Date(startTime),
                endTime: new Date(),
                durationMs: Date.now() - startTime,
              },
            });
          }
        }, 10000);

        this.process.stdout?.on('data', async (data: Buffer) => {
          const chunk = data.toString();
          this.lineBuffer += chunk;
          lastOutputTime = Date.now();

          const lines = this.lineBuffer.split('\n');
          this.lineBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const json = JSON.parse(line);
              const result = this.processStreamEvent(json);

              if (result.output) {
                this.outputBuffer += result.output;
                await this.emitOutput(result.output, false, true);
              }

              if (result.sessionId) {
                this.claudeSessionId = result.sessionId;
              }

              if (result.isQuestion) {
                hasDetectedQuestion = true;
                detectedQuestionText = result.questionText || '';

                // 質問検出時にプロセスを停止
                if (this.process && !this.process.killed) {
                  this.process.kill('SIGTERM');
                }
              }
            } catch {
              // chcpコマンドの出力など不要な行をフィルタリング
              const trimmedLine = line.trim();
              if (
                !trimmedLine ||
                /^Active code page:/i.test(trimmedLine) ||
                /^現在のコード ページ:/i.test(trimmedLine) ||
                /^chcp\s/i.test(trimmedLine)
              ) {
                continue;
              }
              this.outputBuffer += line + '\n';
              await this.emitOutput(line + '\n', false, true);
            }
          }
        });

        this.process.stderr?.on('data', async (data: Buffer) => {
          const output = data.toString();
          this.errorBuffer += output;
          lastOutputTime = Date.now();
          await this.emitOutput(output, true, true);
        });

        this.process.on('close', (code: number | null) => {
          clearInterval(timeoutCheck);
          const executionTimeMs = Date.now() - startTime;

          if (this.lineBuffer.trim()) {
            this.outputBuffer += this.lineBuffer + '\n';
          }

          if (hasDetectedQuestion) {
            resolve({
              success: true,
              state: 'waiting_for_input',
              output: this.outputBuffer,
              pendingQuestion: {
                questionId: `q-${Date.now()}`,
                text: detectedQuestionText,
                category: 'clarification',
              },
              sessionId: this.claudeSessionId || undefined,
              metrics: {
                startTime: new Date(startTime),
                endTime: new Date(),
                durationMs: executionTimeMs,
              },
            });
            return;
          }

          resolve({
            success: code === 0,
            state: code === 0 ? 'completed' : 'failed',
            output: this.outputBuffer,
            errorMessage: code !== 0 ? `Process exited with code ${code}` : undefined,
            sessionId: this.claudeSessionId || undefined,
            metrics: {
              startTime: new Date(startTime),
              endTime: new Date(),
              durationMs: executionTimeMs,
            },
          });
        });

        this.process.on('error', (error: Error) => {
          clearInterval(timeoutCheck);
          resolve({
            success: false,
            state: 'failed',
            output: this.outputBuffer,
            errorMessage: error.message,
            metrics: {
              startTime: new Date(startTime),
              endTime: new Date(),
              durationMs: Date.now() - startTime,
            },
          });
        });
      } catch (error) {
        resolve({
          success: false,
          state: 'failed',
          output: '',
          errorMessage: error instanceof Error ? error.message : String(error),
          metrics: {
            startTime: new Date(startTime),
            endTime: new Date(),
            durationMs: Date.now() - startTime,
          },
        });
      }
    });
  }

  private async writePromptToStdin(prompt: string): Promise<void> {
    if (!this.process?.stdin) return;

    const stdin = this.process.stdin;
    const CHUNK_SIZE = 16384;
    const promptBuffer = Buffer.from(prompt, 'utf8');

    stdin.on('error', (err) => {
      this.log('error', 'stdin error', { error: err });
    });

    for (let i = 0; i < promptBuffer.length; i += CHUNK_SIZE) {
      const chunk = promptBuffer.subarray(i, Math.min(i + CHUNK_SIZE, promptBuffer.length));
      const canContinue = stdin.write(chunk);

      if (!canContinue) {
        await new Promise<void>((resolve) => {
          stdin.once('drain', resolve);
        });
      }
    }

    stdin.end();
  }

  private processStreamEvent(json: Record<string, unknown>): {
    output: string;
    sessionId?: string;
    isQuestion?: boolean;
    questionText?: string;
  } {
    let output = '';
    let sessionId: string | undefined;
    let isQuestion = false;
    let questionText = '';

    switch (json.type) {
      case 'assistant':
        if (json.message && typeof json.message === 'object') {
          const message = json.message as { content?: unknown[] };
          if (Array.isArray(message.content)) {
            for (const block of message.content) {
              if (typeof block === 'object' && block !== null) {
                const b = block as { type?: string; text?: string; name?: string; input?: unknown };
                if (b.type === 'text' && b.text) {
                  output += b.text;
                } else if (b.type === 'tool_use' && b.name === 'AskUserQuestion') {
                  isQuestion = true;
                  const input = b.input as { questions?: Array<{ question?: string }> } | undefined;
                  if (input?.questions?.[0]?.question) {
                    questionText = input.questions[0].question;
                  }
                  output += `\n[質問] ${questionText}\n`;
                } else if (b.type === 'tool_use') {
                  output += `\n[Tool: ${b.name}]\n`;
                }
              }
            }
          }
        }
        break;

      case 'system':
        if (json.subtype === 'init' && json.session_id) {
          sessionId = json.session_id as string;
        }
        break;

      case 'result':
        if (json.result && typeof json.result === 'string') {
          output += `\n[Result: completed]\n${json.result}\n`;
        }
        break;
    }

    return { output, sessionId, isQuestion, questionText };
  }
}

/**
 * Claude Code プロバイダー
 */
export class ClaudeCodeProvider implements IAgentProvider {
  readonly providerId = 'claude-code' as const;
  readonly providerName = 'Claude Code';
  readonly version = '2.0.0';

  private defaultConfig: ClaudeCodeConfig;

  constructor(config?: Partial<ClaudeCodeConfig>) {
    this.defaultConfig = {
      providerId: 'claude-code',
      enabled: true,
      ...config,
    };
  }

  getCapabilities(): AgentCapabilities {
    return {
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
      parallelExecution: false,
      questionAsking: true,
      conversationMemory: true,
      sessionContinuation: true,
    };
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      const claudePath =
        this.defaultConfig.cliPath ||
        process.env.CLAUDE_CODE_PATH ||
        (isWindows ? 'claude.cmd' : 'claude');

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
  }

  async validateConfig(config: AgentProviderConfig): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (config.providerId !== 'claude-code') {
      errors.push(`Invalid provider ID: ${config.providerId}`);
    }

    const available = await this.isAvailable();
    if (!available) {
      errors.push('Claude Code CLI is not installed or not available');
    }

    return { valid: errors.length === 0, errors };
  }

  async healthCheck(): Promise<AgentHealthStatus> {
    const startTime = Date.now();

    try {
      const available = await this.isAvailable();
      const latency = Date.now() - startTime;

      return {
        healthy: available,
        available,
        latency,
        lastCheck: new Date(),
      };
    } catch (error) {
      return {
        healthy: false,
        available: false,
        errors: [error instanceof Error ? error.message : String(error)],
        lastCheck: new Date(),
      };
    }
  }

  createAgent(config: AgentProviderConfig): IAgent {
    const mergedConfig: ClaudeCodeConfig = {
      ...this.defaultConfig,
      ...config,
    } as ClaudeCodeConfig;

    return new ClaudeCodeAgentV2(mergedConfig);
  }
}

/**
 * デフォルトのClaude Codeプロバイダーインスタンス
 */
export const claudeCodeProvider = new ClaudeCodeProvider();
