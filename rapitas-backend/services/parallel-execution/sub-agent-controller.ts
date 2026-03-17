/**
 * Claude Code CLI
 *
 * (claude-code-agent.ts):
 * - stdin
 * - WindowsUTF-8 (chcp 65001)
 * - Output
 * - AskUserQuestion
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import {
  writeFileSync,
  appendFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  statSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type {
  SubAgentState,
  ParallelExecutionStatus,
  AgentMessage,
  AgentMessageType,
  ExecutionLogEntry,
  ParallelExecutionConfig,
} from './types';
import type { AgentTask, AgentExecutionResult } from '../agents/base-agent';
import { createLogger } from '../../config/logger';

const logger = createLogger('sub-agent-controller');

/**
 */
type QuestionDetails = {
  headers?: string[];
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
};

/**
 */
type SubAgentConfig = {
  agentId: string;
  taskId: number;
  executionId: number;
  workingDirectory: string;
  timeout: number;
  dangerouslySkipPermissions: boolean;
  state: SubAgentState;
};

/**
 * Output
 */
function getLogDirectory(): string {
  const logDir = join(tmpdir(), 'rapitas-subagent-logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

/**
 * Output
 */
function getLogFilePath(taskId: number, executionId: number): string {
  return join(getLogDirectory(), `task-${taskId}-exec-${executionId}.log`);
}

/**
 */
class SubAgent extends EventEmitter {
  readonly config: SubAgentConfig;
  private process: ChildProcess | null = null;
  private state: SubAgentState;
  private outputBuffer: string = '';
  private lineBuffer: string = '';
  private claudeSessionId: string | null = null;
  private logFilePath: string;
  private fileWatchInterval: NodeJS.Timeout | null = null;
  private lastFileSize: number = 0;
  private waitingForInput: boolean = false;
  private detectedQuestion: string | null = null;
  private questionDetails: QuestionDetails | null = null;
  // Tracking
  private activeTools: Map<string, { name: string; startTime: number; info: string }> = new Map();

  constructor(config: SubAgentConfig) {
    super();
    this.config = config;
    this.state = {
      agentId: config.agentId,
      taskId: config.taskId,
      executionId: config.executionId,
      status: 'pending',
      startedAt: new Date(),
      lastActivityAt: new Date(),
      output: '',
      artifacts: [],
      tokensUsed: 0,
      executionTimeMs: 0,
      watingForInput: false,
    };
    // Output
    this.logFilePath = getLogFilePath(config.taskId, config.executionId);
  }

  /**
   * Output
   */
  getLogFilePath(): string {
    return this.logFilePath;
  }

  /**
   */
  async execute(task: AgentTask): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    this.state.status = 'running';
    this.state.startedAt = new Date();
    this.state.lastActivityAt = new Date();

    writeFileSync(
      this.logFilePath,
      `[${new Date().toISOString()}] Task ${this.config.taskId} started\n`,
    );
    logger.info(`[SubAgent ${this.config.agentId}] Log file: ${this.logFilePath}`);

    return new Promise((resolve, reject) => {
      let timeoutCheckInterval: NodeJS.Timeout | null = null;
      let isTimedOut = false;
      let hasReceivedAnyOutput = false;

      const cleanup = () => {
        if (timeoutCheckInterval) {
          clearInterval(timeoutCheckInterval);
          timeoutCheckInterval = null;
        }
        if (this.fileWatchInterval) {
          clearInterval(this.fileWatchInterval);
          this.fileWatchInterval = null;
        }
      };

      try {
        const prompt = this.buildPrompt(task);

        // Windows
        const isWindows = process.platform === 'win32';
        const claudePath = process.env.CLAUDE_CODE_PATH || (isWindows ? 'claude.cmd' : 'claude');

        // （stdin）
        const args: string[] = [];
        args.push('--print');
        args.push('--verbose');
        args.push('--output-format', 'stream-json');

        // --continue
        if (task.resumeSessionId) {
          args.push('--continue');
          logger.info(
            `[SubAgent ${this.config.agentId}] Continuing session: ${task.resumeSessionId}`,
          );
        }

        if (this.config.dangerouslySkipPermissions) {
          args.push('--dangerously-skip-permissions');
        }

        // Windows: UTF-8
        let finalCommand: string;
        let finalArgs: string[];

        if (isWindows) {
          const argsString = args
            .map((arg) => {
              if (arg.includes(' ') || arg.includes('&') || arg.includes('|')) {
                return `"${arg}"`;
              }
              return arg;
            })
            .join(' ');
          finalCommand = `chcp 65001 >NUL 2>&1 && ${claudePath} ${argsString}`;
          finalArgs = [];
        } else {
          finalCommand = claudePath;
          finalArgs = args;
        }

        logger.info(`[SubAgent ${this.config.agentId}] Command: ${finalCommand}`);
        logger.info(
          `[SubAgent ${this.config.agentId}] Working directory: ${this.config.workingDirectory}`,
        );
        logger.info(`[SubAgent ${this.config.agentId}] Prompt length: ${prompt.length} chars`);

        this.process = spawn(finalCommand, finalArgs, {
          cwd: this.config.workingDirectory,
          shell: true,
          windowsHide: true, // NOTE: Prevents TCP handle inheritance — stops CLI process from inheriting port 3001 socket
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            FORCE_COLOR: '0',
            NO_COLOR: '1',
            CI: '1',
            TERM: 'dumb',
            PYTHONUNBUFFERED: '1',
            NODE_OPTIONS: '--no-warnings',
            ...(isWindows && {
              LANG: 'en_US.UTF-8',
              PYTHONIOENCODING: 'utf-8',
              PYTHONUTF8: '1',
              CHCP: '65001',
            }),
          },
        });

        if (this.process.stdout) {
          this.process.stdout.setEncoding('utf8');
        }
        if (this.process.stderr) {
          this.process.stderr.setEncoding('utf8');
        }

        logger.info(
          `[SubAgent ${this.config.agentId}] Process spawned with PID: ${this.process.pid}`,
        );

        // stdin（）
        const writePromptToStdin = async () => {
          if (!this.process?.stdin) {
            logger.info(`[SubAgent ${this.config.agentId}] stdin is not available`);
            return;
          }

          const stdin = this.process.stdin;
          const CHUNK_SIZE = 16384; // 16KB chunks

          stdin.on('error', (err) => {
            logger.error({ err }, `[SubAgent ${this.config.agentId}] stdin error`);
          });

          const promptBuffer = Buffer.from(prompt, 'utf8');
          logger.info(
            `[SubAgent ${this.config.agentId}] Writing ${promptBuffer.length} bytes to stdin`,
          );

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
          logger.info(`[SubAgent ${this.config.agentId}] Prompt written to stdin`);
        };

        writePromptToStdin().catch((err) => {
          logger.error({ err }, `[SubAgent ${this.config.agentId}] Failed to write prompt`);
        });

        // （500ms）
        this.fileWatchInterval = setInterval(() => {
          this.readNewOutputFromFile();
        }, 500);

        const maxExecutionTime = this.config.timeout * 6; // Default 5 min timeout * 6 = 30 min
        timeoutCheckInterval = setInterval(() => {
          const now = Date.now();
          const elapsedTime = now - startTime;

          // 30Output
          const idleTime = now - this.state.lastActivityAt.getTime();
          logger.info(
            `[SubAgent ${this.config.agentId}] Status: elapsed=${Math.floor(elapsedTime / 1000)}s, idle=${Math.floor(idleTime / 1000)}s, output=${this.outputBuffer.length} chars`,
          );

          if (elapsedTime > maxExecutionTime) {
            isTimedOut = true;
            cleanup();
            if (this.process) {
              logger.info(
                `[SubAgent ${this.config.agentId}] Max execution time exceeded (${Math.round(elapsedTime / 1000)}s), timing out...`,
              );
              this.appendToLogFile(
                `\n[TIMEOUT] Max execution time exceeded after ${Math.round(elapsedTime / 1000)}s\n`,
              );
              this.process.kill('SIGTERM');
              reject(
                new Error(
                  `Task execution timed out after ${Math.round(elapsedTime / 1000)}s (max: ${Math.round(maxExecutionTime / 1000)}s)`,
                ),
              );
            }
          }
        }, 30000);

        // Output
        this.process.stdout?.on('data', (data: Buffer | string) => {
          const chunk = data.toString();
          this.lineBuffer += chunk;
          this.state.lastActivityAt = new Date();

          if (!hasReceivedAnyOutput) {
            hasReceivedAnyOutput = true;
            const elapsedMs = Date.now() - startTime;
            logger.info(
              `[SubAgent ${this.config.agentId}] First stdout received after ${elapsedMs}ms`,
            );
          }

          this.appendToLogFile(chunk);

          const lines = this.lineBuffer.split('\n');
          this.lineBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            this.processOutputLine(line);
          }
        });

        // Output
        this.process.stderr?.on('data', (data: Buffer | string) => {
          const chunk = data.toString();
          this.outputBuffer += chunk;
          this.state.output += chunk;
          this.state.lastActivityAt = new Date();

          this.appendToLogFile(`[STDERR] ${chunk}`);

          this.emit('output', chunk, true);
        });

        this.process.on('close', (code) => {
          cleanup();
          this.state.executionTimeMs = Date.now() - startTime;

          this.readNewOutputFromFile();

          this.appendToLogFile(
            `\n[${new Date().toISOString()}] Process exited with code ${code}\n`,
          );

          if (isTimedOut) return;

          if (this.waitingForInput) {
            logger.info(
              `[SubAgent ${this.config.agentId}] Setting status to waiting_for_input (question detected)`,
            );
            logger.info(
              `[SubAgent ${this.config.agentId}] Question: ${this.detectedQuestion?.substring(0, 200)}`,
            );
            logger.info(
              `[SubAgent ${this.config.agentId}] Session ID for resume: ${this.claudeSessionId}`,
            );
            this.state.status = 'waiting_for_input';
            this.state.watingForInput = true;
            this.appendToLogFile(`\n[WAITING] 回答を待っています...\n`);
            resolve({
              success: true, // Technically successful but not complete — waiting for user input
              output: this.state.output,
              tokensUsed: this.state.tokensUsed,
              executionTimeMs: this.state.executionTimeMs,
              claudeSessionId: this.claudeSessionId || undefined,
              waitingForInput: true,
              question: this.detectedQuestion || undefined,
              questionDetails: this.questionDetails || undefined,
            });
            return;
          }

          if (code === 0) {
            this.state.status = 'completed';
            resolve({
              success: true,
              output: this.state.output,
              tokensUsed: this.state.tokensUsed,
              executionTimeMs: this.state.executionTimeMs,
              claudeSessionId: this.claudeSessionId || undefined,
            });
          } else {
            this.state.status = 'failed';
            resolve({
              success: false,
              output: this.state.output,
              errorMessage: `Process exited with code ${code}`,
              tokensUsed: this.state.tokensUsed,
              executionTimeMs: this.state.executionTimeMs,
            });
          }
        });

        this.process.on('error', (error) => {
          cleanup();
          this.state.status = 'failed';
          this.state.executionTimeMs = Date.now() - startTime;
          this.appendToLogFile(`\n[ERROR] ${error.message}\n`);
          reject(error);
        });
      } catch (error) {
        cleanup();
        this.state.status = 'failed';
        reject(error);
      }
    });
  }

  /**
   */
  private appendToLogFile(content: string): void {
    try {
      appendFileSync(this.logFilePath, content);
    } catch (error) {
      logger.error({ err: error }, `[SubAgent ${this.config.agentId}] Failed to write to log file`);
    }
  }

  /**
   * Output
   */
  private readNewOutputFromFile(): void {
    try {
      if (!existsSync(this.logFilePath)) return;

      const stat = statSync(this.logFilePath);
      if (stat.size > this.lastFileSize) {
        const fd = require('fs').openSync(this.logFilePath, 'r');
        const buffer = Buffer.alloc(stat.size - this.lastFileSize);
        require('fs').readSync(fd, buffer, 0, stat.size - this.lastFileSize, this.lastFileSize);
        require('fs').closeSync(fd);

        const newContent = buffer.toString('utf8');
        if (newContent) {
          this.state.lastActivityAt = new Date();
          // Output（DB）
          this.emit('output', newContent, false);
        }

        this.lastFileSize = stat.size;
      }
    } catch (error) {}
  }

  /**
   * Output
   */
  private processOutputLine(line: string): void {
    try {
      if (line.startsWith('{')) {
        const json = JSON.parse(line);

        // ID
        if (json.session_id) {
          this.claudeSessionId = json.session_id;
          logger.info(`[SubAgent ${this.config.agentId}] Session ID: ${this.claudeSessionId}`);
        }

        // Output
        let displayOutput = '';
        switch (json.type) {
          case 'system':
            if (json.subtype === 'init') {
              displayOutput = `[System: init]\n`;
            } else if (json.subtype === 'error') {
              const errorMsg =
                typeof json.message === 'string' ? json.message : json.error || 'unknown';
              displayOutput = `[System Error: ${errorMsg}]\n`;
            }
            break;
          case 'assistant':
            if (json.message?.content) {
              for (const block of json.message.content) {
                if (block.type === 'text' && block.text) {
                  displayOutput += block.text;
                } else if (block.type === 'tool_use') {
                  // AskUserQuestion（）
                  if (block.name === 'AskUserQuestion') {
                    logger.info(`[SubAgent ${this.config.agentId}] AskUserQuestion tool detected!`);
                    logger.info(
                      { toolInput: block.input },
                      `[SubAgent ${this.config.agentId}] Tool input`,
                    );

                    const questionInfo = this.extractQuestionInfo(block.input);
                    this.waitingForInput = true;
                    this.detectedQuestion = questionInfo.questionText;
                    this.questionDetails = questionInfo.questionDetails || null;
                    this.state.status = 'waiting_for_input';

                    displayOutput += `\n[質問] ${questionInfo.questionText}\n`;

                    this.emit('question_detected', {
                      question: questionInfo.questionText,
                      questionDetails: questionInfo.questionDetails,
                    });

                    logger.info(
                      `[SubAgent ${this.config.agentId}] Stopping process to wait for user response`,
                    );
                    if (this.process && !this.process.killed) {
                      this.process.kill('SIGTERM');
                    }
                  } else {
                    const toolInfo = this.formatToolInfo(block.name, block.input);
                    displayOutput += `[Tool: ${block.name}] ${toolInfo}\n`;
                    // Tracking
                    if (block.id) {
                      this.activeTools.set(block.id, {
                        name: block.name,
                        startTime: Date.now(),
                        info: toolInfo,
                      });
                    }
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
                  const activeTool = toolId ? this.activeTools.get(toolId) : undefined;

                  if (activeTool) {
                    const duration = ((Date.now() - activeTool.startTime) / 1000).toFixed(1);
                    if (block.is_error) {
                      displayOutput += `[Tool Error: ${activeTool.name}] (${duration}s)\n`;
                    } else {
                      displayOutput += `[Tool Done: ${activeTool.name}] (${duration}s)\n`;
                    }
                    this.activeTools.delete(toolId);
                  } else {
                    const toolIdShort = toolId ? `ID: ${toolId.substring(0, 8)}...` : '';
                    if (block.is_error) {
                      displayOutput += `[Tool Error ${toolIdShort}]\n`;
                    } else {
                      displayOutput += `[Tool Done ${toolIdShort}]\n`;
                    }
                  }
                }
              }
            }
            break;
          case 'result':
            if (json.result) {
              const duration = json.duration_ms
                ? ` (${(json.duration_ms / 1000).toFixed(1)}s)`
                : '';
              const cost = json.cost_usd ? ` $${json.cost_usd.toFixed(4)}` : '';
              displayOutput += `\n[Result: ${json.subtype || 'completed'}${duration}${cost}]\n`;
              if (json.result && typeof json.result === 'string') {
                displayOutput +=
                  json.result.substring(0, 500) + (json.result.length > 500 ? '...' : '') + '\n';
              }
            }
            break;
        }

        if (displayOutput) {
          this.outputBuffer += displayOutput;
          this.state.output += displayOutput;
          // Output
          this.emit('output', displayOutput, false);
        }
      } else {
        // JSON: chcpOutput
        const trimmedLine = line.trim();
        if (
          !trimmedLine ||
          /^Active code page:/i.test(trimmedLine) ||
          /^現在のコード ページ:/i.test(trimmedLine) ||
          /^chcp\s/i.test(trimmedLine)
        ) {
          return;
        }
        this.outputBuffer += line + '\n';
        this.state.output += line + '\n';
        this.emit('output', line + '\n', false);
      }
    } catch {
      // JSON: chcpOutput
      const trimmedLine = line.trim();
      if (
        !trimmedLine ||
        /^Active code page:/i.test(trimmedLine) ||
        /^現在のコード ページ:/i.test(trimmedLine) ||
        /^chcp\s/i.test(trimmedLine)
      ) {
        return;
      }
      this.outputBuffer += line + '\n';
      this.state.output += line + '\n';
      this.emit('output', line + '\n', false);
    }
  }

  /**
   * AskUserQuestion
   */
  private extractQuestionInfo(input: Record<string, unknown> | undefined): {
    questionText: string;
    questionDetails?: QuestionDetails;
  } {
    if (!input) {
      return { questionText: '' };
    }

    let questionText = '';
    const questionDetails: QuestionDetails = {};

    // questions（）
    if (input.questions && Array.isArray(input.questions)) {
      const questions = input.questions as Array<{
        question?: string;
        header?: string;
        options?: Array<{ label: string; description?: string }>;
        multiSelect?: boolean;
      }>;

      questionText = questions
        .map((q) => q.question || q.header || '')
        .filter((q) => q)
        .join('\n');

      const headers = questions.map((q) => q.header).filter((h): h is string => !!h);
      if (headers.length > 0) {
        questionDetails.headers = headers;
      }

      const firstQuestion = questions[0];
      if (firstQuestion) {
        if (firstQuestion.options && Array.isArray(firstQuestion.options)) {
          questionDetails.options = firstQuestion.options.map((opt) => ({
            label: opt.label || '',
            description: opt.description,
          }));
        }
        if (typeof firstQuestion.multiSelect === 'boolean') {
          questionDetails.multiSelect = firstQuestion.multiSelect;
        }
      }
    } else if (input.question && typeof input.question === 'string') {
      questionText = input.question;
    }

    const hasDetails =
      questionDetails.headers?.length ||
      questionDetails.options?.length ||
      questionDetails.multiSelect !== undefined;

    return {
      questionText,
      questionDetails: hasDetails ? questionDetails : undefined,
    };
  }

  /**
   */
  private formatToolInfo(toolName: string, input: Record<string, unknown> | undefined): string {
    if (!input) return '';

    try {
      switch (toolName) {
        case 'Read':
          return input.file_path ? `-> ${String(input.file_path).split(/[/\\]/).pop()}` : '';
        case 'Write':
          return input.file_path ? `-> ${String(input.file_path).split(/[/\\]/).pop()}` : '';
        case 'Edit':
          return input.file_path ? `-> ${String(input.file_path).split(/[/\\]/).pop()}` : '';
        case 'Glob':
          return input.pattern ? `pattern: ${input.pattern}` : '';
        case 'Grep':
          return input.pattern ? `pattern: ${input.pattern}` : '';
        case 'Bash':
          const cmd = String(input.command || '');
          return cmd.length > 50 ? `$ ${cmd.substring(0, 50)}...` : `$ ${cmd}`;
        case 'Task':
          return input.description ? String(input.description) : '';
        case 'WebFetch':
          return input.url ? `-> ${String(input.url).substring(0, 40)}...` : '';
        case 'WebSearch':
          return input.query ? `"${input.query}"` : '';
        case 'LSP':
          return input.operation ? String(input.operation) : '';
        default: {
          // NOTE: Serialize object/array values as JSON to avoid "[object Object]"
          const firstKey = Object.keys(input)[0];
          if (firstKey && input[firstKey] != null) {
            const raw = input[firstKey];
            const val = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
            return val.length > 80 ? `${val.substring(0, 80)}...` : val;
          }
          return '';
        }
      }
    } catch {
      return '';
    }
  }

  /**
   * （buildStructuredPrompt）
   */
  private buildPrompt(task: AgentTask): string {
    if (task.optimizedPrompt) {
      logger.info(
        `[SubAgent ${this.config.agentId}] Using optimized prompt (${task.optimizedPrompt.length} chars)`,
      );
      return task.optimizedPrompt;
    }

    const sections: string[] = [];

    sections.push('# タスク実行指示');
    sections.push('');

    if (task.title) {
      sections.push(`## タスク: ${task.title}`);
      sections.push('');
    }

    if (task.description) {
      sections.push('## 詳細');
      sections.push(task.description);
      sections.push('');
    }

    // AIAnalysis results
    if (task.analysisInfo) {
      const analysis = task.analysisInfo;

      sections.push('## 実装情報');
      if (analysis.summary) {
        sections.push(`- **サマリー:** ${analysis.summary}`);
      }
      if (analysis.complexity) {
        const complexityLabels: Record<string, string> = {
          simple: 'シンプル',
          medium: '中程度',
          complex: '複雑',
        };
        sections.push(
          `- **複雑度:** ${complexityLabels[analysis.complexity] || analysis.complexity}`,
        );
      }
      if (analysis.estimatedTotalHours) {
        sections.push(`- **推定時間:** ${analysis.estimatedTotalHours}時間`);
      }
      sections.push('');

      if (analysis.tips && analysis.tips.length > 0) {
        sections.push('## 実装のヒント');
        for (const tip of analysis.tips) {
          sections.push(`- ${tip}`);
        }
        sections.push('');
      }

      if (analysis.reasoning) {
        sections.push('## 実装方針');
        sections.push(analysis.reasoning);
        sections.push('');
      }
    }

    sections.push('## 実行指示');
    sections.push('上記のタスクを実装してください。');
    sections.push('不明点がある場合は、質問してください。');
    sections.push('');

    sections.push('## 注意事項');
    sections.push('このタスクは他のタスクと並列で実行されている可能性があります。');
    sections.push('- このタスクは専用のgit worktreeで実行されています。git操作は安全に行えます。');
    sections.push('- 作業完了後は変更をコミットし、リモートにプッシュしてください。');
    sections.push('- 進捗状況を明確にOutputすること');

    return sections.join('\n');
  }

  /**
   */
  stop(): void {
    if (this.fileWatchInterval) {
      clearInterval(this.fileWatchInterval);
      this.fileWatchInterval = null;
    }
    if (this.process) {
      this.process.kill('SIGTERM');
      this.state.status = 'cancelled';
    }
  }

  /**
   */
  getState(): SubAgentState {
    return { ...this.state };
  }

  /**
   */
  getStatus(): ParallelExecutionStatus {
    return this.state.status;
  }
}

/**
 */
export class SubAgentController extends EventEmitter {
  private agents: Map<string, SubAgent> = new Map();
  private config: ParallelExecutionConfig;
  private messageQueue: AgentMessage[] = [];
  private isProcessingMessages: boolean = false;

  constructor(config: ParallelExecutionConfig) {
    super();
    this.config = config;
  }

  /**
   */
  createAgent(taskId: number, executionId: number, workingDirectory: string): string {
    const agentId = `agent-${taskId}-${Date.now()}`;

    const agent = new SubAgent({
      agentId,
      taskId,
      executionId,
      workingDirectory,
      timeout: this.config.taskTimeoutSeconds * 1000,
      dangerouslySkipPermissions: true,
      state: {
        agentId,
        taskId,
        executionId,
        status: 'pending',
        startedAt: new Date(),
        lastActivityAt: new Date(),
        watingForInput: false,
        output: '',
        artifacts: [],
        tokensUsed: 0,
        executionTimeMs: 0,
      },
    });

    // Output
    agent.on('output', (chunk: string, isError: boolean) => {
      this.emit('agent_output', {
        agentId,
        taskId,
        executionId,
        chunk,
        isError,
        timestamp: new Date(),
      });

      if (this.config.logSharing) {
        this.broadcastMessage({
          id: `msg-${Date.now()}`,
          timestamp: new Date(),
          fromAgentId: agentId,
          toAgentId: 'broadcast',
          type: 'task_progress',
          payload: {
            taskId,
            chunk: chunk.slice(0, 500),
          },
        });
      }
    });

    this.agents.set(agentId, agent);

    const logFilePath = agent.getLogFilePath();
    logger.info(`[SubAgentController] Created agent ${agentId} for task ${taskId}`);
    logger.info(`[SubAgentController] Log file: ${logFilePath}`);

    return agentId;
  }

  /**
   */
  getAgentLogFilePath(agentId: string): string | null {
    const agent = this.agents.get(agentId);
    return agent ? agent.getLogFilePath() : null;
  }

  /**
   */
  async executeTask(agentId: string, task: AgentTask): Promise<AgentExecutionResult> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    this.emit('task_started', {
      agentId,
      taskId: task.id,
      timestamp: new Date(),
    });

    this.broadcastMessage({
      id: `msg-${Date.now()}`,
      timestamp: new Date(),
      fromAgentId: agentId,
      toAgentId: 'broadcast',
      type: 'task_started',
      payload: { taskId: task.id, title: task.title },
    });

    try {
      const result = await agent.execute(task);

      this.emit(result.success ? 'task_completed' : 'task_failed', {
        agentId,
        taskId: task.id,
        result,
        timestamp: new Date(),
      });

      this.broadcastMessage({
        id: `msg-${Date.now()}`,
        timestamp: new Date(),
        fromAgentId: agentId,
        toAgentId: 'broadcast',
        type: result.success ? 'task_completed' : 'task_failed',
        payload: {
          taskId: task.id,
          success: result.success,
          executionTimeMs: result.executionTimeMs,
        },
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.emit('task_failed', {
        agentId,
        taskId: task.id,
        error: errorMessage,
        timestamp: new Date(),
      });

      this.broadcastMessage({
        id: `msg-${Date.now()}`,
        timestamp: new Date(),
        fromAgentId: agentId,
        toAgentId: 'broadcast',
        type: 'task_failed',
        payload: { taskId: task.id, error: errorMessage },
      });

      return {
        success: false,
        output: '',
        errorMessage,
      };
    }
  }

  /**
   */
  stopAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.stop();
      logger.info(`[SubAgentController] Stopped agent ${agentId}`);
    }
  }

  /**
   */
  stopAllAgents(): void {
    for (const [agentId, agent] of this.agents) {
      agent.stop();
    }
    this.agents.clear();
    logger.info('[SubAgentController] Stopped all agents');
  }

  /**
   */
  getAgentState(agentId: string): SubAgentState | null {
    const agent = this.agents.get(agentId);
    return agent ? agent.getState() : null;
  }

  /**
   */
  getAllAgentStates(): Map<string, SubAgentState> {
    const states = new Map<string, SubAgentState>();
    for (const [agentId, agent] of this.agents) {
      states.set(agentId, agent.getState());
    }
    return states;
  }

  /**
   */
  getActiveAgentCount(): number {
    let count = 0;
    for (const agent of this.agents.values()) {
      if (agent.getStatus() === 'running') {
        count++;
      }
    }
    return count;
  }

  /**
   */
  broadcastMessage(message: AgentMessage): void {
    if (!this.config.coordinationEnabled) return;

    this.messageQueue.push(message);
    this.processMessageQueue();

    this.emit('message', message);
  }

  /**
   */
  sendMessage(
    toAgentId: string,
    fromAgentId: string,
    type: AgentMessageType,
    payload: unknown,
  ): void {
    if (!this.config.coordinationEnabled) return;

    const message: AgentMessage = {
      id: `msg-${Date.now()}`,
      timestamp: new Date(),
      fromAgentId,
      toAgentId,
      type,
      payload,
    };

    this.messageQueue.push(message);
    this.processMessageQueue();

    this.emit('message', message);
  }

  /**
   */
  private async processMessageQueue(): Promise<void> {
    if (this.isProcessingMessages || this.messageQueue.length === 0) return;

    this.isProcessingMessages = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      this.logMessage(message);
    }

    this.isProcessingMessages = false;
  }

  /**
   */
  private logMessage(message: AgentMessage): void {
    const entry: ExecutionLogEntry = {
      timestamp: message.timestamp,
      agentId: message.fromAgentId,
      taskId: 0,
      level: 'info',
      message: `[${message.type}] ${JSON.stringify(message.payload).slice(0, 200)}`,
      metadata: {
        messageId: message.id,
        toAgentId: message.toAgentId,
        type: message.type,
      },
    };

    this.emit('log', entry);
  }

  /**
   */
  removeAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.stop();
      this.agents.delete(agentId);
      logger.info(`[SubAgentController] Removed agent ${agentId}`);
    }
  }

  /**
   * ID
   */
  getRunningTaskIds(): number[] {
    const taskIds: number[] = [];
    for (const agent of this.agents.values()) {
      if (agent.getStatus() === 'running') {
        taskIds.push(agent.config.taskId);
      }
    }
    return taskIds;
  }
}

/**
 */
export function createSubAgentController(config: ParallelExecutionConfig): SubAgentController {
  return new SubAgentController(config);
}
