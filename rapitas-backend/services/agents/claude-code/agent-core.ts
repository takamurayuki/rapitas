/**
 * ClaudeCodeAgent Core
 *
 * Spawns Claude Code CLI as a child process to execute tasks.
 * Delegates prompt building, CLI resolution, git diffing, question parsing, and idle monitoring
 * to sub-modules in this directory.
 */

import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BaseAgent } from '../base-agent';
import type {
  AgentCapability,
  AgentTask,
  AgentExecutionResult,
  AgentArtifact,
  GitCommitInfo,
} from '../base-agent';
import { createInitialWaitingState } from '../question-detection';
import type { QuestionWaitingState } from '../question-detection';
import type { WorkerOutputMessage, WorkerInputMessage } from '../../../workers/output-parser-types';
import { createLogger } from '../../../config/logger';
import { getProjectRoot } from '../../../config';
import { registerProcess, unregisterProcess } from '../agent-process-tracker';
import { getClaudePath, buildSpawnCommand, checkClaudeAvailable } from './cli-utils';
import { buildStructuredPrompt } from './prompt-builder';
import { startIdleMonitor } from './idle-monitor';
import { handleWorkerMessage } from './worker-message-handler';
import { buildResolveAfterParse } from './execution-resolver';

const logger = createLogger('claude-code-agent');

export type ClaudeCodeAgentConfig = {
  workingDirectory?: string;
  model?: string;
  dangerouslySkipPermissions?: boolean;
  timeout?: number; // milliseconds
  maxTokens?: number;
  continueConversation?: boolean; // Whether to continue the previous conversation
  resumeSessionId?: string; // Session ID used with --resume
};

export class ClaudeCodeAgent extends BaseAgent {
  // NOTE: The fields below are marked `/** @internal */` and exposed as
  // public so the helpers in worker-message-handler.ts and
  // execution-resolver.ts can mutate them. They are NOT part of the
  // public API of ClaudeCodeAgent — do not access them from outside the
  // claude-code/ directory.

  /** @internal */
  public process: ChildProcess | null = null;
  /** @internal */
  public config: ClaudeCodeAgentConfig;
  /** @internal */
  public outputBuffer: string = '';
  /** @internal */
  public errorBuffer: string = '';
  /** @internal Buffer for parsing stream-json format */
  public lineBuffer: string = '';
  /** @internal Question waiting state (key-based detection system) */
  public detectedQuestion: QuestionWaitingState = createInitialWaitingState();
  /** @internal */
  public activeTools: Map<string, { name: string; startTime: number; info: string }> = new Map();
  /** @internal Claude Code session ID (for resuming conversations via --resume) */
  public claudeSessionId: string | null = null;
  /** @internal Whether file-modifying tools (Write, Edit, NotebookEdit, Bash) were used successfully */
  public hasFileModifyingToolCalls: boolean = false;
  /** @internal Flag indicating forced termination due to idle hang */
  public idleTimeoutForceKilled: boolean = false;
  /** @internal Worker thread for output parsing */
  public parserWorker: Worker | null = null;
  /** @internal Artifacts parsed by the Worker */
  public workerArtifacts: AgentArtifact[] = [];
  /** @internal Commits parsed by the Worker */
  public workerCommits: GitCommitInfo[] = [];
  /** @internal Callback invoked when parse-complete finishes */
  public onParseComplete: (() => void) | null = null;

  constructor(id: string, name: string, config: ClaudeCodeAgentConfig = {}) {
    super(id, name, 'claude-code');
    this.config = {
      timeout: 900000, // 15 minutes default
      ...config,
    };
  }

  /** @internal Top-level alias of `config.resumeSessionId` for helper context. */
  public get resumeSessionId(): string | undefined {
    return this.config.resumeSessionId;
  }

  /** @internal Top-level alias of `config.continueConversation` for helper context. */
  public get continueConversation(): boolean | undefined {
    return this.config.continueConversation;
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

  /**
   * Handle all messages received from the output-parser Worker thread.
   * Delegates to the free function in worker-message-handler.ts for the
   * actual switch logic — this is a 1-line wrapper that adapts the agent
   * to the helper's `WorkerMessageContext` shape.
   *
   * @param msg - Typed message from the Worker / Workerからの型付きメッセージ
   */
  private handleWorkerMessage(msg: WorkerOutputMessage): void {
    handleWorkerMessage(this as unknown as Parameters<typeof handleWorkerMessage>[0], msg);
  }

  /** @internal Proxy for BaseAgent's protected emitOutput, used by helpers. */
  public emitOutputInternal(output: string, isError: boolean = false): void {
    this.emitOutput(output, isError);
  }

  /** @internal Proxy for BaseAgent's protected emitQuestionDetected, used by helpers. */
  public emitQuestionDetectedInternal(
    info: Parameters<ClaudeCodeAgent['emitQuestionDetected']>[0],
  ): void {
    this.emitQuestionDetected(info);
  }

  /** @internal Proxy for the private killProcessForQuestion, used by helpers. */
  public killProcessForQuestionInternal(): void {
    this.killProcessForQuestion();
  }

  /**
   * Build the resolution callback used after the Worker finishes parsing.
   * Thin wrapper that constructs a `ResolverContext` view of `this` and
   * delegates to the free function in execution-resolver.ts.
   */
  private buildResolveAfterParse(
    code: number | null,
    workDir: string,
    startTime: number,
    resolve: (result: AgentExecutionResult) => void,
  ): () => void {
    return buildResolveAfterParse(
      this as unknown as Parameters<typeof buildResolveAfterParse>[0],
      code,
      workDir,
      startTime,
      resolve,
      () => this.workerArtifacts,
      () => this.workerCommits,
    );
  }

  async execute(task: AgentTask, options?: Record<string, unknown>): Promise<AgentExecutionResult> {
    this.status = 'running';
    this.outputBuffer = '';
    this.errorBuffer = '';
    this.lineBuffer = '';
    this.detectedQuestion = createInitialWaitingState();
    this.activeTools.clear();
    this.claudeSessionId = null;
    this.hasFileModifyingToolCalls = false;
    this.idleTimeoutForceKilled = false;
    this.workerArtifacts = [];
    this.workerCommits = [];
    this.onParseComplete = null;
    const startTime = Date.now();

    const timeout = this.config.timeout ?? 900000; // 15 minutes

    const fs = await import('fs/promises');
    const workDir = task.workingDirectory || this.config.workingDirectory || getProjectRoot();

    // Verify working directory exists before spawning
    try {
      const stats = await fs.stat(workDir);
      if (!stats.isDirectory()) {
        this.status = 'failed';
        return {
          success: false,
          output: '',
          errorMessage: `Working directory is not a directory: ${workDir}`,
          executionTimeMs: Date.now() - startTime,
        };
      }
    } catch (error) {
      this.status = 'failed';
      return {
        success: false,
        output: '',
        errorMessage: `Working directory does not exist: ${workDir}`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Verify Claude CLI is available before execution
    const isClaudeAvailable = await checkClaudeAvailable();
    if (!isClaudeAvailable) {
      this.status = 'failed';
      return {
        success: false,
        output: '',
        errorMessage: `Claude Code CLI not found.`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    return new Promise((resolve) => {
      // In --resume or --continue mode, use the prompt (user response) as-is
      // Adding extra text would break the session resumption context
      const isResumeMode = !!(this.config.resumeSessionId || this.config.continueConversation);
      const prompt = isResumeMode
        ? task.description || task.title
        : buildStructuredPrompt(task, workDir, this.logPrefix);

      if (task.analysisInfo) {
        logger.info(`${this.logPrefix} Using structured prompt with AI task analysis`);
        logger.info(`${this.logPrefix} Analysis complexity: ${task.analysisInfo.complexity}`);
        logger.info(`${this.logPrefix} Subtasks count: ${task.analysisInfo.subtasks?.length || 0}`);
      } else {
        logger.info(`${this.logPrefix} Using simple prompt (no AI task analysis)`);
      }

      // Save prompt to temp file to bypass Windows command-line character limit
      const tempDir = join(tmpdir(), 'rapitas-prompts');
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }
      const promptFile = join(tempDir, `prompt-${Date.now()}.txt`);
      writeFileSync(promptFile, prompt, 'utf-8');

      // Build Claude Code CLI command
      const args: string[] = [];
      args.push('--print');
      args.push('--verbose');
      args.push('--output-format', 'stream-json');

      if (this.config.resumeSessionId) {
        args.push('--resume', this.config.resumeSessionId);
        logger.info(
          `${this.logPrefix} Resuming specific session with --resume ${this.config.resumeSessionId}`,
        );
      } else if (this.config.continueConversation) {
        args.push('--continue');
        logger.info(`${this.logPrefix} Continuing most recent conversation with --continue`);
      }

      if (this.config.dangerouslySkipPermissions) {
        args.push('--dangerously-skip-permissions');
        // NOTE: Also set permission-mode to ensure all file edits (including .claude/) are allowed
        args.push('--permission-mode', 'bypassPermissions');
      }
      if (this.config.model) {
        args.push('--model', this.config.model);
      }
      if (this.config.maxTokens) {
        args.push('--max-tokens', String(this.config.maxTokens));
      }

      // NOTE: Working directory is set via spawn({ cwd: workDir }) at line 618.
      // Claude Code CLI inherits the shell's working directory — no --directory flag needed.

      // NOTE: Disable worktree tools to prevent the spawned CLI from creating nested worktrees
      // that conflict with rapitas-managed worktrees and could corrupt .git/ directory structure.
      args.push('--disallowedTools', 'EnterWorktree,ExitWorktree');

      const claudePath = getClaudePath();
      const [finalCommand, finalArgs] = buildSpawnCommand(claudePath, args);

      logger.info(`${this.logPrefix} Platform: ${process.platform}`);
      logger.info(`${this.logPrefix} Claude path: ${claudePath}`);
      logger.info(`${this.logPrefix} Work directory: ${workDir}`);
      logger.info(`${this.logPrefix} Prompt length: ${prompt.length} chars / Timeout: ${timeout}ms`);
      logger.info(`${this.logPrefix} Args: ${args.join(' ')}`);

      this.emitOutput(`${this.logPrefix} Starting execution...\n`);
      this.emitOutput(`${this.logPrefix} Working directory: ${workDir}\n`);
      this.emitOutput(`${this.logPrefix} Timeout: ${timeout / 1000}s\n`);
      this.emitOutput(
        `${this.logPrefix} Prompt: ${prompt.substring(0, 200)}${prompt.length > 200 ? '...' : ''}\n\n`,
      );

      const cleanupPromptFile = () => {
        try {
          unlinkSync(promptFile);
        } catch (_) {
          // Prompt file may already be deleted
        }
      };

      try {
        logger.info(`${this.logPrefix} Final command: ${finalCommand}`);

        const isWindows = process.platform === 'win32';
        this.process = spawn(finalCommand, finalArgs, {
          cwd: workDir,
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
              CHCP: '65001', // Enable UTF-8 mode on Windows 10+
            }),
          },
        });

        if (this.process.stdout) {
          this.process.stdout.setEncoding('utf8');
        }
        if (this.process.stderr) {
          this.process.stderr.setEncoding('utf8');
        }

        logger.info(`${this.logPrefix} Process spawned with PID: ${this.process.pid}`);
        this.emitOutput(`${this.logPrefix} Process PID: ${this.process.pid}\n`);

        if (this.process.pid) {
          registerProcess({
            pid: this.process.pid,
            role: 'cli-agent',
            taskId: task.id,
            startedAt: new Date().toISOString(),
            parentPid: process.pid,
          });
        }

        // Write prompt to stdin asynchronously in chunks to avoid buffering issues
        const writePromptToStdin = async () => {
          if (!this.process?.stdin) {
            logger.info(`${this.logPrefix} stdin is not available`);
            return;
          }
          const stdin = this.process.stdin;
          const CHUNK_SIZE = 16384; // 16KB chunks

          stdin.on('error', (err) => {
            logger.error({ err }, `${this.logPrefix} stdin error`);
          });

          // Convert prompt to UTF-8 Buffer to prevent encoding issues
          const promptBuffer = Buffer.from(prompt, 'utf8');
          logger.info(`${this.logPrefix} Prompt buffer size: ${promptBuffer.length} bytes`);

          for (let i = 0; i < promptBuffer.length; i += CHUNK_SIZE) {
            const chunk = promptBuffer.subarray(i, Math.min(i + CHUNK_SIZE, promptBuffer.length));
            const canContinue = stdin.write(chunk);
            if (!canContinue) {
              await new Promise<void>((r) => stdin.once('drain', r));
            }
          }

          stdin.end();
          logger.info(
            `${this.logPrefix} Prompt written to stdin (${promptBuffer.length} bytes) in chunks`,
          );
        };

        writePromptToStdin().catch((err) => {
          logger.error({ err }, `${this.logPrefix} Failed to write prompt to stdin`);
        });

        this.lineBuffer = '';

        // Start idle and timeout monitors
        const monitor = startIdleMonitor(this.logPrefix, timeout, startTime, {
          onFlushLineBuffer: (content) => {
            this.outputBuffer += content;
            this.emitOutput(content);
            this.lineBuffer = '';
          },
          onTimeout: (result) => {
            this.status = 'failed';
            resolve(result);
          },
          getLineBuffer: () => this.lineBuffer,
          getOutputBufferLength: () => this.outputBuffer.length,
          getOutputBuffer: () => this.outputBuffer,
          getErrorBuffer: () => this.errorBuffer,
          getStatus: () => this.status,
          getProcess: () => this.process,
          setIdleTimeoutForceKilled: (v) => { this.idleTimeoutForceKilled = v; },
        });

        // Spawn a Worker for output parsing
        this.parserWorker = new Worker(
          new URL('../../../workers/output-parser-worker.ts', import.meta.url).href,
        );
        this.parserWorker.postMessage({
          type: 'configure',
          config: {
            timeoutSeconds: this.config.timeout
              ? Math.floor(this.config.timeout / 1000)
              : undefined,
            logPrefix: this.logPrefix,
          },
        } satisfies WorkerInputMessage);

        this.parserWorker.onmessage = (event: MessageEvent<WorkerOutputMessage>) => {
          this.handleWorkerMessage(event.data);
        };

        this.parserWorker.onerror = (error: ErrorEvent) => {
          logger.error({ errorMessage: error.message }, `${this.logPrefix} Worker uncaught error`);
        };

        this.process.stdout?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          monitor.recordOutput();
          monitor.markReceivedOutput();

          const elapsedMs = Date.now() - startTime;
          logger.info(
            `${this.logPrefix} First stdout received after ${elapsedMs}ms (${chunk.length} chars)`,
          );

          // Delegate chunk to Worker (parsing runs on the Worker thread)
          try {
            this.parserWorker?.postMessage({
              type: 'parse-chunk',
              data: chunk,
            } satisfies WorkerInputMessage);
          } catch (workerErr) {
            // Ignore if Worker is already terminated (InvalidStateError)
            logger.warn(
              { errorDetail: workerErr instanceof Error ? workerErr.message : workerErr },
              `${this.logPrefix} Worker postMessage failed`,
            );
            this.parserWorker = null;
          }
        });

        this.process.stderr?.on('data', (data: Buffer) => {
          const output = data.toString();
          this.errorBuffer += output;
          monitor.recordOutput(); // Treat stderr as output to reset the timeout
          logger.info(
            `${this.logPrefix} stderr (${output.length} chars): ${output.substring(0, 200)}`,
          );
          this.emitOutput(output, true);
        });

        this.process.on('close', (code: number | null) => {
          monitor.cleanup();
          cleanupPromptFile();
          if (this.process?.pid) {
            unregisterProcess(this.process.pid);
          }
          const executionTimeMs = Date.now() - startTime;

          if (this.lineBuffer.trim()) {
            logger.info(
              `${this.logPrefix} Processing remaining lineBuffer: ${this.lineBuffer.substring(0, 200)}`,
            );
            this.outputBuffer += this.lineBuffer + '\n';
            this.emitOutput(this.lineBuffer + '\n');
          }

          logger.info(
            `${this.logPrefix} Process closed with code: ${code}, time: ${executionTimeMs}ms`,
          );
          logger.info(`${this.logPrefix} Final output length: ${this.outputBuffer.length}`);
          logger.info(
            `${this.logPrefix} Last 500 chars of output: ${this.outputBuffer.slice(-500)}`,
          );

          if (this.status === 'cancelled') {
            resolve({
              success: false,
              output: this.outputBuffer,
              errorMessage: 'Execution cancelled',
              executionTimeMs,
            });
            return;
          }

          // Skip if already resolved by timeout
          if (this.status === 'failed') {
            return;
          }

          const resolveAfterParse = this.buildResolveAfterParse(code, workDir, startTime, resolve);

          // If a Worker exists, send parse-complete and wait for results;
          // otherwise fall back to direct execution
          if (this.parserWorker) {
            this.workerArtifacts = [];
            this.workerCommits = [];
            this.onParseComplete = resolveAfterParse;

            try {
              this.parserWorker.postMessage({
                type: 'parse-complete',
                outputBuffer: this.outputBuffer,
              } satisfies WorkerInputMessage);
            } catch (workerErr) {
              logger.warn(
                { errorDetail: workerErr instanceof Error ? workerErr.message : workerErr },
                `${this.logPrefix} Worker postMessage failed on parse-complete, falling back`,
              );
              this.onParseComplete = null;
              resolveAfterParse();
            }
          } else {
            resolveAfterParse();
          }
        });

        this.process.on('error', (error: Error) => {
          monitor.cleanup();
          cleanupPromptFile();
          if (this.process?.pid) {
            unregisterProcess(this.process.pid);
          }
          this.status = 'failed';
          logger.error({ err: error }, `${this.logPrefix} Process error`);
          this.emitOutput(`${this.logPrefix} Error: ${error.message}\n`, true);

          const errorParts: string[] = [];
          errorParts.push(`Process startup error: ${error.message}`);
          if (this.errorBuffer.trim()) {
            errorParts.push(`\n\n【Standard Error Output】\n${this.errorBuffer.trim()}`);
          }
          if (this.outputBuffer.trim()) {
            errorParts.push(`\n\n【Standard Output】\n${this.outputBuffer.trim().slice(-500)}`);
          }

          resolve({
            success: false,
            output: this.outputBuffer,
            errorMessage: errorParts.join(''),
            executionTimeMs: Date.now() - startTime,
          });
        });
      } catch (error) {
        // NOTE: This catch block handles errors before spawn, so monitor is not yet started
        cleanupPromptFile();
        this.status = 'failed';
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ err: error }, `${this.logPrefix} Spawn error`);
        resolve({
          success: false,
          output: '',
          errorMessage,
          executionTimeMs: Date.now() - startTime,
        });
      }
    });
  }

  /**
   * Gracefully stops the process when a question is detected.
   * Uses taskkill on Windows, SIGTERM on Unix.
   * Unlike stop(), does not set status to cancelled (preserves waiting_for_input).
   */
  private killProcessForQuestion(): void {
    if (!this.process || this.process.killed) return;

    if (process.platform === 'win32') {
      try {
        const pid = this.process.pid;
        if (pid) {
          const { execSync: exec } = require('child_process');
          exec(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
          logger.info(`${this.logPrefix} Process ${pid} killed via taskkill (question detected)`);
        }
      } catch (e) {
        logger.error({ err: e }, `${this.logPrefix} taskkill failed (question detected)`);
        try {
          this.process.kill();
        } catch (killErr) {
          logger.warn(
            { err: killErr },
            `${this.logPrefix} process.kill() also failed (question detected)`,
          );
        }
      }
    } else {
      this.process.kill('SIGTERM');
    }
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.status = 'cancelled';
      this.emitOutput(`\n${this.logPrefix} Stopping execution...\n`);

      if (process.platform === 'win32') {
        try {
          const pid = this.process.pid;
          if (pid) {
            const { execSync: exec } = require('child_process');
            // /T terminates the entire process tree, /F forces termination
            exec(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
            logger.info(`${this.logPrefix} Process ${pid} killed via taskkill`);
          }
        } catch (e) {
          logger.error({ err: e }, `${this.logPrefix} taskkill failed`);
          try {
            this.process.kill();
          } catch (killErr) {
            logger.warn({ err: killErr }, `${this.logPrefix} process.kill() also failed`);
          }
        }
      } else {
        // On Unix, send SIGINT for graceful shutdown
        this.process.kill('SIGINT');

        // Send SIGTERM if still running after 5 seconds
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
      }

      this.process = null;
    }
  }

  async pause(): Promise<boolean> {
    if (this.process && this.status === 'running') {
      this.process.kill('SIGSTOP');
      this.status = 'paused';
      this.emitOutput(`\n${this.logPrefix} Execution paused\n`);
      return true;
    }
    return false;
  }

  async resume(): Promise<boolean> {
    if (this.process && this.status === 'paused') {
      this.process.kill('SIGCONT');
      this.status = 'running';
      this.emitOutput(`\n${this.logPrefix} Execution resumed\n`);
      return true;
    }
    return false;
  }

  async isAvailable(): Promise<boolean> {
    return checkClaudeAvailable();
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

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
