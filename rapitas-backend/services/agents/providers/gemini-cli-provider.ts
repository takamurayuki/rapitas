/**
 * Gemini CLI Provider
 *
 * Gemini CLI agent provider compatible with the abstraction layer.
 * Gemini CLI: @google/gemini-cli (npm install -g @google/gemini-cli)
 * https://github.com/google-gemini/gemini-cli
 */

import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { getProjectRoot } from '../../../config';
import type {
  AgentCapabilities,
  AgentProviderConfig,
  GeminiCliProviderConfig,
  AgentHealthStatus,
  AgentExecutionContext,
  AgentTaskDefinition,
  AgentExecutionResult,
  ContinuationContext,
} from '../abstraction/types';
import type { IAgentProvider, IAgent } from '../abstraction/interfaces';
import { AbstractAgent } from '../abstraction/abstract-agent';
import { generateAgentId } from '../abstraction';

/**
 * Gemini CLI provider configuration
 */
export interface GeminiCliConfig extends GeminiCliProviderConfig {
  workingDirectory?: string;
  model?: string; // e.g. gemini-2.0-flash, gemini-1.5-flash
  timeout?: number;
  maxTokens?: number;
}

/**
 * Gemini CLI stream-json event type
 */
interface GeminiStreamEvent {
  type: 'assistant' | 'user' | 'result' | 'system' | 'tool_use' | 'tool_result';
  subtype?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      id?: string;
      input?: Record<string, unknown>;
      is_error?: boolean;
      tool_use_id?: string;
    }>;
  };
  result?: string;
  duration_ms?: number;
  cost_usd?: number;
  session_id?: string;
  checkpoint_id?: string;
  error?: string;
}

/**
 * Gemini CLI Agent (v2 - abstraction layer compatible)
 */
export class GeminiCliAgentV2 extends AbstractAgent {
  private config: GeminiCliConfig;
  private process: import('child_process').ChildProcess | null = null;
  private outputBuffer = '';
  private errorBuffer = '';
  private lineBuffer = '';
  private geminiSessionId: string | null = null;
  private checkpointId: string | null = null;

  constructor(config: GeminiCliConfig) {
    super(generateAgentId('gemini-cli'), config.model || 'Gemini CLI Agent', 'google-gemini', {
      version: '1.0.0',
      description: 'Google Gemini CLI を使用したコード生成・編集エージェント',
      modelId: config.model,
    });
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
      const geminiPath = resolveCliPath(
        this.config.cliPath || process.env.GEMINI_CLI_PATH || (isWindows ? 'gemini.cmd' : 'gemini'),
      );

      const proc = spawn(geminiPath, ['--version'], { shell: true });

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
      errors.push(
        'Gemini CLI is not installed or not available in PATH. Install with: npm install -g @google/gemini-cli',
      );
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
    this.geminiSessionId = null;
    this.checkpointId = null;

    const prompt = this.buildPrompt(task);
    const workDir = context.workingDirectory || this.config.workingDirectory || getProjectRoot();

    return this.runGeminiCli(prompt, workDir, context);
  }

  protected async doContinue(
    continuation: ContinuationContext,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    this.outputBuffer = '';
    this.errorBuffer = '';
    this.lineBuffer = '';

    const prompt = continuation.userResponse || '';
    const workDir = context.workingDirectory || this.config.workingDirectory || getProjectRoot();

    // Temporarily set checkpoint ID for continuation
    const originalCheckpoint = this.config.checkpointId;
    this.config.checkpointId = continuation.sessionId;

    try {
      return await this.runGeminiCli(prompt, workDir, context);
    } finally {
      this.config.checkpointId = originalCheckpoint;
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
          } catch (killErr) {
            // Final fallback kill failed - process may already be terminated
          }
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

  private async runGeminiCli(
    prompt: string,
    workDir: string,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const timeout = context.timeout || this.config.timeout || 900000;
      const isWindows = process.platform === 'win32';
      const geminiPath = resolveCliPath(
        this.config.cliPath || process.env.GEMINI_CLI_PATH || (isWindows ? 'gemini.cmd' : 'gemini'),
      );

      const args: string[] = [];

      // Non-interactive mode: pass prompt via -p flag
      args.push('-p', prompt);

      args.push('--output-format', 'stream-json');

      if (this.config.sandboxMode) {
        args.push('--sandbox');
      }

      if (this.config.yolo || context.dangerouslySkipPermissions) {
        args.push('--yolo');
      }

      if (this.config.model) {
        // Map model names to the format expected by Gemini CLI
        const modelMapping: Record<string, string> = {
          'gemini-2.0-flash': 'gemini-2.0-flash-exp-0111',
          'gemini-1.5-flash': 'gemini-1.5-flash',
          'gemini-1.5-pro': 'gemini-1.5-pro',
          'gemini-2.0-flash-thinking': 'gemini-2.0-flash-thinking-exp-01-21',
        };

        let modelName = this.config.model;

        if (modelMapping[modelName]) {
          modelName = modelMapping[modelName];
        }

        // Gemini CLI requires models/ prefix
        if (!modelName.startsWith('models/')) {
          modelName = `models/${modelName}`;
        }

        args.push('-m', modelName);
      }

      // Resume conversation from checkpoint
      if (this.config.checkpointId) {
        args.push('--checkpoint', this.config.checkpointId);
      }

      if (this.config.allowedTools && this.config.allowedTools.length > 0) {
        args.push('--allowlist', this.config.allowedTools.join(','));
      }

      if (this.config.disallowedTools && this.config.disallowedTools.length > 0) {
        args.push('--denylist', this.config.disallowedTools.join(','));
      }

      let finalCommand: string;
      let finalArgs: string[];

      if (isWindows) {
        const argsString = args
          .map((arg) => {
            if (arg.includes(' ') || arg.includes('&') || arg.includes('|')) {
              return `"${arg.replace(/"/g, '\\"')}"`;
            }
            return arg;
          })
          .join(' ');
        const quotedPath = geminiPath.includes(' ') ? `"${geminiPath}"` : geminiPath;
        finalCommand = `chcp 65001 >NUL 2>&1 && ${quotedPath} ${argsString}`;
        finalArgs = [];
      } else {
        finalCommand = geminiPath;
        finalArgs = args;
      }

      this.log('info', `Starting Gemini CLI execution`, {
        workDir,
        promptLength: prompt.length,
        command: isWindows ? finalCommand : `${finalCommand} ${args.join(' ')}`,
        model: this.config.model,
      });

      try {
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
          CI: '1',
          TERM: 'dumb',
        };

        if (this.config.apiKey) {
          env.GEMINI_API_KEY = this.config.apiKey;
          // Gemini CLI may also use GOOGLE_API_KEY
          env.GOOGLE_API_KEY = this.config.apiKey;
        }
        if (this.config.projectId) {
          env.GOOGLE_CLOUD_PROJECT = this.config.projectId;
        }
        if (this.config.location) {
          env.GOOGLE_CLOUD_LOCATION = this.config.location;
        }

        // Log API key presence (only prefix for security)
        const hasApiKey =
          !!env.GEMINI_API_KEY || !!process.env.GEMINI_API_KEY || !!process.env.GOOGLE_API_KEY;
        const apiKeyPrefix = (
          env.GEMINI_API_KEY ||
          process.env.GEMINI_API_KEY ||
          process.env.GOOGLE_API_KEY ||
          ''
        ).substring(0, 8);
        this.log('info', 'Gemini API configuration', {
          hasApiKey,
          apiKeyPrefix: apiKeyPrefix ? `${apiKeyPrefix}...` : 'NOT SET',
          hasProjectId: !!env.GOOGLE_CLOUD_PROJECT,
          hasLocation: !!env.GOOGLE_CLOUD_LOCATION,
        });

        this.process = spawn(finalCommand, finalArgs, {
          cwd: workDir,
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
        });

        if (this.process.stdout) {
          this.process.stdout.setEncoding('utf8');
        }
        if (this.process.stderr) {
          this.process.stderr.setEncoding('utf8');
        }

        // stdin must be closed since prompt is passed via -p flag
        if (this.process.stdin) {
          this.process.stdin.end();
        }

        let lastOutputTime = Date.now();
        let hasDetectedQuestion = false;
        let detectedQuestionText = '';

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
              const json = JSON.parse(line) as GeminiStreamEvent;
              const result = this.processStreamEvent(json);

              if (result.output) {
                this.outputBuffer += result.output;
                await this.emitOutput(result.output, false, true);
              }

              if (result.sessionId) {
                this.geminiSessionId = result.sessionId;
              }

              if (result.checkpointId) {
                this.checkpointId = result.checkpointId;
              }

              if (result.isQuestion) {
                hasDetectedQuestion = true;
                detectedQuestionText = result.questionText || '';

                // Stop process on question detection to hand control back to user
                if (this.process && !this.process.killed) {
                  this.process.kill('SIGTERM');
                }
              }
            } catch {
              // Filter out non-JSON lines (e.g. Windows chcp output)
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

          this.log('error', 'Gemini CLI stderr output', {
            error: output,
            model: this.config.model,
            workDir,
          });

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
              sessionId: this.checkpointId || this.geminiSessionId || undefined,
              metrics: {
                startTime: new Date(startTime),
                endTime: new Date(),
                durationMs: executionTimeMs,
              },
            });
            return;
          }

          let errorMessage = undefined;
          if (code !== 0) {
            errorMessage = `Process exited with code ${code}`;
            if (this.errorBuffer.trim()) {
              errorMessage += `\nError output: ${this.errorBuffer.trim()}`;
            }
            if (
              this.errorBuffer.includes('ModelNotFoundError') ||
              this.errorBuffer.includes('Requested entity was not found')
            ) {
              errorMessage +=
                '\nNote: The specified model may not be available. Try using a different model or check your API access.';
            }
          }

          resolve({
            success: code === 0,
            state: code === 0 ? 'completed' : 'failed',
            output: this.outputBuffer,
            errorMessage,
            sessionId: this.checkpointId || this.geminiSessionId || undefined,
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

  private processStreamEvent(json: GeminiStreamEvent): {
    output: string;
    sessionId?: string;
    checkpointId?: string;
    isQuestion?: boolean;
    questionText?: string;
  } {
    let output = '';
    let sessionId: string | undefined;
    let checkpointId: string | undefined;
    let isQuestion = false;
    let questionText = '';

    switch (json.type) {
      case 'assistant':
        if (json.message?.content) {
          for (const block of json.message.content) {
            if (block.type === 'text' && block.text) {
              output += block.text;
            } else if (block.type === 'tool_use') {
              if (
                block.name === 'AskUserQuestion' ||
                block.name === 'ask_user' ||
                block.name === 'ask'
              ) {
                isQuestion = true;
                const input = block.input as
                  | { questions?: Array<{ question?: string }> }
                  | undefined;
                if (input?.questions?.[0]?.question) {
                  questionText = input.questions[0].question;
                }
                output += `\n[質問] ${questionText}\n`;
              } else {
                output += `\n[Tool: ${block.name}]\n`;
              }
            }
          }
        }
        break;

      case 'user':
        if (json.message?.content) {
          for (const block of json.message.content) {
            if (block.type === 'tool_result') {
              const toolId = block.tool_use_id;
              if (block.is_error) {
                output += `[Tool Error]\n`;
              } else {
                output += `[Tool Done]\n`;
              }
            }
          }
        }
        break;

      case 'system':
        if (json.session_id) {
          sessionId = json.session_id;
        }
        if (json.checkpoint_id) {
          checkpointId = json.checkpoint_id;
        }
        if (json.subtype === 'error' || json.error) {
          output += `[System Error: ${json.error || json.subtype || 'unknown'}]\n`;
        }
        break;

      case 'result':
        if (json.result && typeof json.result === 'string') {
          const duration = json.duration_ms ? ` (${(json.duration_ms / 1000).toFixed(1)}s)` : '';
          const cost = json.cost_usd ? ` $${json.cost_usd.toFixed(4)}` : '';
          output += `\n[Result: completed${duration}${cost}]\n${json.result}\n`;
        }
        break;
    }

    return { output, sessionId, checkpointId, isQuestion, questionText };
  }

  /**
   * Returns the checkpoint ID for session continuation.
   */
  getCheckpointId(): string | null {
    return this.checkpointId;
  }

  /**
   * Returns the Gemini session ID.
   */
  getSessionId(): string | null {
    return this.geminiSessionId;
  }
}

function resolveCliPath(cliName: string): string {
  if (process.platform !== 'win32') return cliName;
  try {
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
    // Fallback to original path
  }
  return cliName;
}

/**
 * Gemini CLI Provider
 */
export class GeminiCliProvider implements IAgentProvider {
  readonly providerId = 'google-gemini' as const;
  readonly providerName = 'Gemini CLI';
  readonly version = '1.0.0';

  private defaultConfig: GeminiCliConfig;

  constructor(config?: Partial<GeminiCliConfig>) {
    this.defaultConfig = {
      providerId: 'google-gemini',
      enabled: true,
      model: 'gemini-2.0-flash',
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
      const geminiPath = resolveCliPath(
        this.defaultConfig.cliPath ||
          process.env.GEMINI_CLI_PATH ||
          (isWindows ? 'gemini.cmd' : 'gemini'),
      );

      const proc = spawn(geminiPath, ['--version'], { shell: true });

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

    if (config.providerId !== 'google-gemini') {
      errors.push(`Invalid provider ID: ${config.providerId}`);
    }

    const available = await this.isAvailable();
    if (!available) {
      errors.push(
        'Gemini CLI is not installed or not available. Install with: npm install -g @google/gemini-cli',
      );
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
    const mergedConfig: GeminiCliConfig = {
      ...this.defaultConfig,
      ...config,
    } as GeminiCliConfig;

    return new GeminiCliAgentV2(mergedConfig);
  }
}

/**
 * Default Gemini CLI provider instance
 */
export const geminiCliProvider = new GeminiCliProvider();
