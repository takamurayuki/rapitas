/**
 * ClaudeCodeAgent
 *
 * Spawns Claude Code CLI as a child process to execute tasks.
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BaseAgent } from './base-agent';
import type {
  AgentCapability,
  AgentTask,
  AgentExecutionResult,
  AgentArtifact,
  GitCommitInfo,
  TaskAnalysisInfo,
  QuestionType,
} from './base-agent';
import {
  detectQuestionFromToolCall,
  createInitialWaitingState,
  updateWaitingStateFromDetection,
  tolegacyQuestionType,
  toExecutionResultFormat,
} from './question-detection';
import type { QuestionDetails, QuestionKey, QuestionWaitingState } from './question-detection';
import type { WorkerOutputMessage, WorkerInputMessage } from '../../workers/output-parser-types';
import { createLogger } from '../../config/logger';
import { getProjectRoot } from '../../config';
import { registerProcess, unregisterProcess } from './agent-process-tracker';

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

/**
 * Resolves the absolute path of a CLI command on Windows.
 * Falls back to the original path if PATH resolution fails.
 */
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
      logger.info(`[resolveCliPath] Resolved ${cliName} -> ${resolved}`);
      return resolved;
    }
  } catch {
    logger.warn(`[resolveCliPath] Failed to resolve ${cliName}, using relative path`);
  }
  return cliName;
}

export class ClaudeCodeAgent extends BaseAgent {
  private process: ChildProcess | null = null;
  private config: ClaudeCodeAgentConfig;
  private outputBuffer: string = '';
  private errorBuffer: string = '';
  private lineBuffer: string = ''; // Buffer for parsing stream-json format
  /** Question waiting state (key-based detection system) */
  private detectedQuestion: QuestionWaitingState = createInitialWaitingState();
  private activeTools: Map<string, { name: string; startTime: number; info: string }> = new Map();
  /** Claude Code session ID (for resuming conversations via --resume) */
  private claudeSessionId: string | null = null;
  /** Whether file-modifying tools (Write, Edit, NotebookEdit, Bash) were used successfully */
  private hasFileModifyingToolCalls: boolean = false;
  /** Flag indicating forced termination due to idle hang */
  private idleTimeoutForceKilled: boolean = false;
  /** Set of file-modifying tool names */
  private static readonly FILE_MODIFYING_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
  /** Worker thread for output parsing */
  private parserWorker: Worker | null = null;
  /** Artifacts parsed by the Worker */
  private workerArtifacts: AgentArtifact[] = [];
  /** Commits parsed by the Worker */
  private workerCommits: GitCommitInfo[] = [];
  /** Callback invoked when parse-complete finishes */
  private onParseComplete: (() => void) | null = null;

  constructor(id: string, name: string, config: ClaudeCodeAgentConfig = {}) {
    super(id, name, 'claude-code');
    this.config = {
      timeout: 900000, // 15 minutes default
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

    // Ensure timeout default is set
    const timeout = this.config.timeout ?? 900000; // 15 minutes

    // Perform async operations before the Promise executor to avoid making it async
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
    const isClaudeAvailable = await this.isAvailable();
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
        : this.buildStructuredPrompt(task);

      // Log AI task analysis usage
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
      args.push('--verbose'); // Get more detailed output for real-time streaming
      args.push('--output-format', 'stream-json'); // Output in JSON streaming format

      // Continue a previous conversation
      // --resume <sessionId> resumes a specific session
      // --continue resumes the most recent conversation (fallback when no session ID)
      if (this.config.resumeSessionId) {
        // Resume specific session when session ID is available
        args.push('--resume', this.config.resumeSessionId);
        logger.info(
          `${this.logPrefix} Resuming specific session with --resume ${this.config.resumeSessionId}`,
        );
        logger.info(`${this.logPrefix} Resume mode: prompt will be sent as user response`);
      } else if (this.config.continueConversation) {
        // Continue the most recent conversation when no session ID is available
        args.push('--continue');
        logger.info(`${this.logPrefix} Continuing most recent conversation with --continue`);
        logger.info(`${this.logPrefix} Resume mode: prompt will be sent as user response`);
      }

      if (this.config.dangerouslySkipPermissions) {
        args.push('--dangerously-skip-permissions');
      }

      if (this.config.model) {
        args.push('--model', this.config.model);
      }

      if (this.config.maxTokens) {
        args.push('--max-tokens', String(this.config.maxTokens));
      }

      // CRITICAL: Specify working directory for Claude Code CLI
      // NOTE: cwd in spawn() only sets the shell's working directory,
      // but Claude Code needs --directory to know where to work
      args.push('--directory', workDir);

      // NOTE: Disable worktree tools to prevent the spawned CLI from creating nested worktrees
      // that conflict with rapitas-managed worktrees and could corrupt .git/ directory structure.
      args.push('--disallowedTools', 'EnterWorktree,ExitWorktree');

      // On Windows, use .cmd file (resolved to absolute path to avoid PATH resolution issues)
      const isWindows = process.platform === 'win32';
      const baseClaudePath = process.env.CLAUDE_CODE_PATH || (isWindows ? 'claude.cmd' : 'claude');
      const claudePath = resolveCliPath(baseClaudePath);

      logger.info(`${this.logPrefix} Platform: ${process.platform}`);
      logger.info(`${this.logPrefix} Claude path: ${claudePath}`);
      logger.info(`${this.logPrefix} Work directory: ${workDir}`);
      logger.info(`${this.logPrefix} Prompt file: ${promptFile}`);

      logger.info(`${this.logPrefix} ========================================`);
      logger.info(`${this.logPrefix} Working directory: ${workDir}`);
      logger.info(`${this.logPrefix} Prompt length: ${prompt.length} chars`);
      logger.info(`${this.logPrefix} Timeout: ${timeout}ms`);
      logger.info(`${this.logPrefix} Args: ${args.join(' ')}`);
      logger.info(`${this.logPrefix} ========================================`);

      this.emitOutput(`${this.logPrefix} Starting execution...\n`);
      this.emitOutput(`${this.logPrefix} Working directory: ${workDir}\n`);
      this.emitOutput(`${this.logPrefix} Timeout: ${timeout / 1000}s\n`);
      this.emitOutput(
        `${this.logPrefix} Prompt: ${prompt.substring(0, 200)}${prompt.length > 200 ? '...' : ''}\n\n`,
      );

      // Store temp file path for later cleanup
      const cleanupPromptFile = () => {
        try {
          unlinkSync(promptFile);
        } catch (_) {
          // Prompt file may already be deleted
        }
      };

      try {
        logger.info(`${this.logPrefix} Spawn command: ${claudePath}`);
        logger.info(`${this.logPrefix} Args: ${args.join(' ')}`);

        // Spawn Claude Code with shell: true
        // Add encoding settings for Windows
        let finalCommand: string;
        let finalArgs: string[];

        if (isWindows) {
          // On Windows, set UTF-8 code page with chcp 65001 before running claude.cmd
          // Build as single command string including args so the shell interprets correctly
          const argsString = args
            .map((arg) => {
              // Quote args containing spaces or special characters
              if (arg.includes(' ') || arg.includes('&') || arg.includes('|')) {
                return `"${arg}"`;
              }
              return arg;
            })
            .join(' ');
          // Quote absolute path in case it contains spaces
          const quotedPath = claudePath.includes(' ') ? `"${claudePath}"` : claudePath;
          finalCommand = `chcp 65001 >NUL 2>&1 && ${quotedPath} ${argsString}`;
          finalArgs = []; // Args are embedded in the command string
        } else {
          finalCommand = claudePath;
          finalArgs = args;
        }

        logger.info(`${this.logPrefix} Final command: ${finalCommand}`);

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
            // Windows UTF-8 encoding settings
            ...(isWindows && {
              LANG: 'en_US.UTF-8',
              PYTHONIOENCODING: 'utf-8',
              PYTHONUTF8: '1',
              // Enable UTF-8 mode on Windows 10+
              CHCP: '65001',
            }),
          },
        });

        // Set stdout to immediate mode for faster output retrieval
        if (this.process.stdout) {
          this.process.stdout.setEncoding('utf8');
        }
        if (this.process.stderr) {
          this.process.stderr.setEncoding('utf8');
        }

        logger.info(`${this.logPrefix} Process spawned with PID: ${this.process.pid}`);
        this.emitOutput(`${this.logPrefix} Process PID: ${this.process.pid}\n`);

        // Register PID for tracking even after crashes
        if (this.process.pid) {
          registerProcess({
            pid: this.process.pid,
            role: 'cli-agent',
            taskId: task.id,
            startedAt: new Date().toISOString(),
            parentPid: process.pid,
          });
        }
        logger.info(`${this.logPrefix} Prompt file: ${promptFile} (${prompt.length} chars)`);

        // Write to stdin asynchronously to avoid buffering issues
        // Write prompt in chunks and wait for drain events
        // Use UTF-8 Buffer to prevent encoding issues
        const writePromptToStdin = async () => {
          if (!this.process?.stdin) {
            logger.info(`${this.logPrefix} stdin is not available`);
            return;
          }

          const stdin = this.process.stdin;
          const CHUNK_SIZE = 16384; // 16KB chunks

          // Set stdin error handler
          stdin.on('error', (err) => {
            logger.error({ err }, `${this.logPrefix} stdin error`);
          });

          // Convert prompt to UTF-8 Buffer to prevent encoding issues
          const promptBuffer = Buffer.from(prompt, 'utf8');
          logger.info(`${this.logPrefix} Prompt buffer size: ${promptBuffer.length} bytes`);

          // Write in chunks using Buffer
          for (let i = 0; i < promptBuffer.length; i += CHUNK_SIZE) {
            const chunk = promptBuffer.subarray(i, Math.min(i + CHUNK_SIZE, promptBuffer.length));
            const canContinue = stdin.write(chunk);

            if (!canContinue) {
              // Wait for drain when buffer is full
              await new Promise<void>((resolve) => {
                stdin.once('drain', resolve);
              });
            }
          }

          // Close stdin after writing completes
          stdin.end();
          logger.info(
            `${this.logPrefix} Prompt written to stdin (${promptBuffer.length} bytes) in chunks`,
          );
        };

        // Start writing to stdin asynchronously (catch errors)
        writePromptToStdin().catch((err) => {
          logger.error({ err }, `${this.logPrefix} Failed to write prompt to stdin`);
        });

        // Reset stream-json parsing buffer
        this.lineBuffer = '';

        // Output idle timeout: force-flush buffer when no stdout data for a period
        let lastOutputTime = Date.now();
        let hasReceivedAnyOutput = false;
        this.idleTimeoutForceKilled = false; // Idle hang force-kill flag (instance variable)
        const OUTPUT_IDLE_TIMEOUT = 30000; // 30 seconds
        const INITIAL_OUTPUT_TIMEOUT = 60000; // Initial output timeout: 60 seconds
        const MAX_OUTPUT_IDLE_TIMEOUT = 300000; // 5 min: treat as hung if idle for 5 min after output

        const idleCheckInterval = setInterval(() => {
          const idleTime = Date.now() - lastOutputTime;
          const totalElapsed = Date.now() - startTime;

          // Warn if no output received after 60 seconds
          if (!hasReceivedAnyOutput && totalElapsed > INITIAL_OUTPUT_TIMEOUT) {
            logger.warn(
              `${this.logPrefix} WARNING: No output received after ${Math.floor(totalElapsed / 1000)}s - Claude Code may not be responding`,
            );
            this.emitOutput(
              `\n[Warning] ${Math.floor(totalElapsed / 1000)} seconds elapsed without response from Claude Code. Continuing processing...\n`,
            );
            // Set flag so this warning is emitted only once
            hasReceivedAnyOutput = true;
          }

          if (idleTime > OUTPUT_IDLE_TIMEOUT && this.lineBuffer.trim()) {
            logger.info(
              `${this.logPrefix} Output idle for ${idleTime}ms, flushing lineBuffer (${this.lineBuffer.length} chars)`,
            );
            // Force flush remaining buffer
            this.outputBuffer += this.lineBuffer + '\n';
            this.emitOutput(this.lineBuffer + '\n');
            this.lineBuffer = '';
          }
          // Periodic status log for debugging
          if (this.status === 'running' && idleTime > 10000) {
            logger.info(
              `${this.logPrefix} Still running... Output idle: ${Math.floor(idleTime / 1000)}s, Buffer: ${this.lineBuffer.length} chars, Total output: ${this.outputBuffer.length} chars, HasOutput: ${hasReceivedAnyOutput}`,
            );
          }

          // Idle hang detection: if idle for MAX_OUTPUT_IDLE_TIMEOUT after producing output, treat as hung
          if (
            hasReceivedAnyOutput &&
            idleTime > MAX_OUTPUT_IDLE_TIMEOUT &&
            !this.lineBuffer.trim() &&
            this.status === 'running' &&
            this.process &&
            !this.process.killed
          ) {
            logger.warn(
              `${this.logPrefix} OUTPUT IDLE HANG DETECTED: No output for ${Math.floor(idleTime / 1000)}s after producing ${this.outputBuffer.length} chars. Force-killing hung process.`,
            );
            this.emitOutput(
              `\n${this.logPrefix} Process has been unresponsive for ${Math.floor(idleTime / 1000)} seconds, treating as hang and force-terminating.\n`,
            );
            this.idleTimeoutForceKilled = true;
            clearInterval(idleCheckInterval);

            // Force-kill the process
            const pid = this.process.pid;
            if (process.platform === 'win32') {
              try {
                if (pid) {
                  execSync(`taskkill /PID ${pid} /T /F`, {
                    stdio: 'ignore',
                    windowsHide: true,
                  });
                  logger.info(`${this.logPrefix} Process ${pid} killed via taskkill (idle hang)`);
                }
              } catch (e) {
                logger.warn(
                  { err: e },
                  `${this.logPrefix} taskkill failed (idle hang), trying process.kill()`,
                );
                try {
                  this.process.kill();
                } catch (killErr) {
                  logger.warn(
                    { err: killErr },
                    `${this.logPrefix} process.kill() also failed (idle hang)`,
                  );
                }
              }
            } else {
              this.process.kill('SIGTERM');
            }
          }
        }, 5000); // Check every 5 seconds

        // Clear interval when process completes
        const cleanupIdleCheck = () => {
          clearInterval(idleCheckInterval);
        };

        // Timeout only applies when there is no output
        // Periodically check if timeout elapsed since last output
        const timeoutCheckInterval = setInterval(() => {
          if (this.process && !this.process.killed) {
            const timeSinceLastOutput = Date.now() - lastOutputTime;

            // Only timeout when no output has been received since the last check
            if (timeSinceLastOutput >= timeout) {
              logger.info(`${this.logPrefix} TIMEOUT: No output for ${timeout / 1000}s`);
              logger.info(
                `${this.logPrefix} Last output was ${Math.floor(timeSinceLastOutput / 1000)}s ago`,
              );
              logger.info(
                `${this.logPrefix} Output so far: ${this.outputBuffer.substring(0, 500)}`,
              );
              logger.info(`${this.logPrefix} Error so far: ${this.errorBuffer.substring(0, 500)}`);
              logger.info(`${this.logPrefix} LineBuffer: ${this.lineBuffer.substring(0, 500)}`);
              clearInterval(timeoutCheckInterval);
              cleanupIdleCheck();
              this.emitOutput(
                `\n${this.logPrefix} Execution timed out (no output for ${timeout / 1000}s)\n`,
                true,
              );
              this.process.kill('SIGTERM');
              this.status = 'failed';
              resolve({
                success: false,
                output: this.outputBuffer,
                errorMessage: `Execution timed out (no output for ${timeout / 1000}s)`,
                executionTimeMs: Date.now() - startTime,
              });
            }
          }
        }, 10000);

        // Timeout check cleanup function
        const cleanupTimeoutCheck = () => {
          clearInterval(timeoutCheckInterval);
        };

        // Spawn a Worker for output parsing
        this.parserWorker = new Worker(
          new URL('../../workers/output-parser-worker.ts', import.meta.url).href,
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

        // Handle messages from the Worker
        this.parserWorker.onmessage = (event: MessageEvent<WorkerOutputMessage>) => {
          const msg = event.data;
          switch (msg.type) {
            case 'system-event':
              if (msg.sessionId) {
                this.claudeSessionId = msg.sessionId;
                logger.info(`${this.logPrefix} Session ID captured: ${this.claudeSessionId}`);
                // In resume mode, verify session ID matches the requested one
                if (this.config.resumeSessionId && this.config.resumeSessionId !== msg.sessionId) {
                  logger.warn(
                    `${this.logPrefix} WARNING: Requested session ${this.config.resumeSessionId} but got ${msg.sessionId}`,
                  );
                  const mismatchWarning = `\n[Warning] Failed to resume specified session (${this.config.resumeSessionId.substring(0, 8)}...). Continuing with new session (${msg.sessionId.substring(0, 8)}...). Previous context may have been lost.\n`;
                  this.outputBuffer += mismatchWarning;
                  this.emitOutput(mismatchWarning);
                }
              }
              if (msg.subtype === 'error') {
                logger.error(`${this.logPrefix} System error event: ${msg.errorMessage}`);
              }
              if (msg.displayOutput) {
                this.outputBuffer += msg.displayOutput;
                this.emitOutput(msg.displayOutput);
              }
              break;

            case 'assistant-message':
              if (msg.displayOutput) {
                this.outputBuffer += msg.displayOutput;
                this.emitOutput(msg.displayOutput);
              }
              // Track active tools on the main thread for reference at close time
              for (const tool of msg.toolUses) {
                this.activeTools.set(tool.id, {
                  name: tool.name,
                  startTime: Date.now(),
                  info: tool.info,
                });
              }
              break;

            case 'user-message':
              if (msg.displayOutput) {
                this.outputBuffer += msg.displayOutput;
                this.emitOutput(msg.displayOutput);
              }
              // Reflect tool completion
              for (const result of msg.toolResults) {
                if (result.toolUseId) {
                  this.activeTools.delete(result.toolUseId);
                }
              }
              break;

            case 'result-event':
              if (msg.displayOutput) {
                this.outputBuffer += msg.displayOutput;
                this.emitOutput(msg.displayOutput);
              }
              break;

            case 'question-detected': {
              const detectionResult = msg.detectionResult;
              logger.info(`${this.logPrefix} AskUserQuestion tool detected via Worker!`);

              // Update question waiting state
              this.detectedQuestion = updateWaitingStateFromDetection(detectionResult);

              logger.info(
                { questionKey: this.detectedQuestion.questionKey },
                `${this.logPrefix} Question key generated`,
              );

              // Emit question detection immediately to trigger DB update
              this.status = 'waiting_for_input';
              this.emitQuestionDetected({
                question: detectionResult.questionText,
                questionType: tolegacyQuestionType(this.detectedQuestion.questionType),
                questionDetails: this.detectedQuestion.questionDetails,
                questionKey: this.detectedQuestion.questionKey,
                claudeSessionId: this.claudeSessionId || undefined,
              });

              if (msg.displayOutput) {
                this.outputBuffer += msg.displayOutput;
                this.emitOutput(msg.displayOutput);
              }

              // Stop the process; will resume via --resume after user answers
              logger.info(`${this.logPrefix} Stopping process to wait for user response`);
              setTimeout(() => {
                if (this.process && !this.process.killed) {
                  logger.info(`${this.logPrefix} Stopping process after stabilization delay (5s)`);
                  this.killProcessForQuestion();
                }
              }, 5000);
              break;
            }

            case 'tool-tracking':
              if (msg.hasFileModifyingToolCalls) {
                this.hasFileModifyingToolCalls = true;
                logger.info(`${this.logPrefix} File-modifying tool detected via Worker`);
              }
              break;

            case 'raw-output':
              if (msg.displayOutput) {
                this.outputBuffer += msg.displayOutput;
                this.emitOutput(msg.displayOutput);
              }
              break;

            case 'artifacts-parsed':
              this.workerArtifacts = msg.data.artifacts;
              logger.info(
                `${this.logPrefix} Artifacts parsed by Worker: ${this.workerArtifacts.length} items`,
              );
              break;

            case 'commits-parsed':
              this.workerCommits = msg.data.commits;
              logger.info(
                `${this.logPrefix} Commits parsed by Worker: ${this.workerCommits.length} items`,
              );
              break;

            case 'parse-complete':
              logger.info(`${this.logPrefix} Worker parse-complete received`);
              if (this.onParseComplete) {
                this.onParseComplete();
                this.onParseComplete = null;
              }
              // Terminate the Worker
              try {
                this.parserWorker?.postMessage({ type: 'terminate' } satisfies WorkerInputMessage);
              } catch {
                // Worker already terminated
              }
              this.parserWorker = null;
              break;

            case 'error':
              logger.error({ stack: msg.stack }, `${this.logPrefix} Worker error: ${msg.message}`);
              break;
          }
        };

        this.parserWorker.onerror = (error: ErrorEvent) => {
          logger.error({ errorMessage: error.message }, `${this.logPrefix} Worker uncaught error`);
        };

        this.process.stdout?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          lastOutputTime = Date.now();

          // Log when the first output arrives
          if (!hasReceivedAnyOutput) {
            hasReceivedAnyOutput = true;
            const elapsedMs = Date.now() - startTime;
            logger.info(
              `${this.logPrefix} First stdout received after ${elapsedMs}ms (${chunk.length} chars)`,
            );
          }

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
          lastOutputTime = Date.now(); // Treat stderr as output to reset the timeout
          logger.info(
            `${this.logPrefix} stderr (${output.length} chars): ${output.substring(0, 200)}`,
          );
          this.emitOutput(output, true);
        });

        this.process.on('close', (code: number | null) => {
          cleanupTimeoutCheck();
          cleanupIdleCheck();
          cleanupPromptFile();
          if (this.process?.pid) {
            unregisterProcess(this.process.pid);
          }
          const executionTimeMs = Date.now() - startTime;

          // Process any remaining lineBuffer content
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

          // Send parse-complete to Worker and wait for artifact/commit parsing results
          const resolveAfterParse = () => {
            const artifacts = this.workerArtifacts;
            const commits = this.workerCommits;

            // Question detection (key-based detection system)
            logger.info(`${this.logPrefix} Running question detection...`);
            logger.info(
              { detectedQuestion: this.detectedQuestion },
              `${this.logPrefix} detectedQuestion from stream`,
            );

            // Use results from the key-based detection system
            const hasQuestion = this.detectedQuestion.hasQuestion;
            const question = this.detectedQuestion.question;
            const questionKey = this.detectedQuestion.questionKey;
            const questionDetails = this.detectedQuestion.questionDetails;

            // Convert questionType for backward compatibility
            const questionType = tolegacyQuestionType(this.detectedQuestion.questionType);

            logger.info(
              `${this.logPrefix} Final question detection - hasQuestion: ${hasQuestion}, questionType: ${questionType}, questionKey: ${JSON.stringify(questionKey)}, exitCode: ${code}`,
            );

            // NOTE: When a question is detected, enter waiting_for_input regardless of exit code.
            // Claude Code may exit with non-zero even after outputting a question.
            if (hasQuestion) {
              this.status = 'waiting_for_input';
              logger.info(
                `${this.logPrefix} Setting status to waiting_for_input (exitCode: ${code})`,
              );
              logger.info(
                `${this.logPrefix} Question detected (${questionType}): ${question.substring(0, 200)}`,
              );
              logger.info({ questionKey }, `${this.logPrefix} Question key`);
              logger.info(`${this.logPrefix} Session ID for resume: ${this.claudeSessionId}`);
              this.emitOutput(`\n${this.logPrefix} Waiting for answer...\n`);
              resolve({
                success: true, // Technically successful but not complete
                output: this.outputBuffer,
                artifacts,
                commits,
                executionTimeMs,
                waitingForInput: true,
                question,
                questionType,
                questionDetails,
                questionKey,
                claudeSessionId: this.claudeSessionId || undefined,
              });
              return;
            }

            // Build a detailed error message on failure
            let errorMessage: string | undefined;
            if (code !== 0) {
              const errorParts: string[] = [];
              errorParts.push(`Process exited with code ${code}`);

              // Include resume mode info (with keywords for fallback detection matching)
              if (this.config.resumeSessionId) {
                errorParts.push(
                  `\n\n【Session Resume Mode】session expired or not found\nSession ID: ${this.config.resumeSessionId}`,
                );
                errorParts.push(`\n* Session may be expired or invalid`);
              } else if (this.config.continueConversation) {
                errorParts.push(`\n\n【Conversation Continue Mode】\nUsing --continue flag`);
              }

              // Append stderr content if available
              if (this.errorBuffer.trim()) {
                errorParts.push(`\n\n【Standard Error Output】\n${this.errorBuffer.trim()}`);
              }

              // Append the tail of stdout (may contain clues about the error)
              if (this.outputBuffer.trim()) {
                const lastOutput = this.outputBuffer.trim().slice(-1000);
                errorParts.push(`\n${lastOutput}`);
              }

              // Append any unprocessed data remaining in the lineBuffer
              if (this.lineBuffer.trim()) {
                errorParts.push(
                  `\n\n【Unprocessed Buffer】\n${this.lineBuffer.trim().slice(-500)}`,
                );
              }

              // NOTE: Very short execution time suggests a failed session resume
              if (executionTimeMs < 10000) {
                errorParts.push(
                  `\n\n【Warning】Execution time of ${executionTimeMs}ms is very short. session expired or not found - session resume may have failed.`,
                );
              }

              errorMessage = errorParts.join('');
              logger.info(
                `${this.logPrefix} Detailed error message constructed (${errorMessage.length} chars)`,
              );
            }

            // Return as failure on error exit, unless the process was force-killed
            // due to idle hang — in that case, proceed to git diff check regardless of exit code
            if (code !== 0 && !this.idleTimeoutForceKilled) {
              logger.info(
                `${this.logPrefix} No question detected, setting status to failed (exitCode: ${code})`,
              );
              this.status = 'failed';
              resolve({
                success: false,
                output: this.outputBuffer,
                artifacts,
                commits,
                executionTimeMs,
                waitingForInput: false,
                claudeSessionId: this.claudeSessionId || undefined,
                errorMessage,
              });
              return;
            }

            if (this.idleTimeoutForceKilled) {
              logger.info(
                `${this.logPrefix} Process was force-killed due to idle hang (exitCode: ${code}). Proceeding to git diff check for completion determination.`,
              );
            }

            // NOTE: On success (code === 0) or idle-hang kill, verify actual changes via git diff.
            // File-modifying tools (Write/Edit) may have been called in plan mode (EnterPlanMode)
            // or via sub-agents (Task) without actually modifying files.
            logger.info(
              `${this.logPrefix} Process exited successfully, verifying actual code changes...`,
            );
            logger.info(
              `${this.logPrefix} hasFileModifyingToolCalls: ${this.hasFileModifyingToolCalls}`,
            );

            this.checkGitDiff(workDir)
              .then((hasChanges) => {
                if (hasChanges) {
                  logger.info(
                    `${this.logPrefix} Git diff confirmed changes, setting status to completed`,
                  );
                  this.status = 'completed';
                  resolve({
                    success: true,
                    output: this.outputBuffer,
                    artifacts,
                    commits,
                    executionTimeMs,
                    waitingForInput: false,
                    claudeSessionId: this.claudeSessionId || undefined,
                  });
                } else if (this.hasFileModifyingToolCalls) {
                  // NOTE: File-modifying tools were used but not reflected in git diff
                  // (rare case, e.g. agent committed & reset). Trust tool usage as completed.
                  logger.info(
                    `${this.logPrefix} No git changes but file-modifying tools were used, setting status to completed`,
                  );
                  this.status = 'completed';
                  resolve({
                    success: true,
                    output: this.outputBuffer,
                    artifacts,
                    commits,
                    executionTimeMs,
                    waitingForInput: false,
                    claudeSessionId: this.claudeSessionId || undefined,
                  });
                } else {
                  // Only planning was done — no implementation
                  logger.info(
                    `${this.logPrefix} No git changes and no file-modifying tools used - agent likely only planned without implementing`,
                  );
                  this.status = 'failed';
                  resolve({
                    success: false,
                    output: this.outputBuffer,
                    artifacts,
                    commits,
                    executionTimeMs,
                    waitingForInput: false,
                    claudeSessionId: this.claudeSessionId || undefined,
                    errorMessage:
                      'Agent output a plan but no actual code changes were made. Please review the prompt and re-execute.',
                  });
                }
              })
              .catch((err) => {
                // If git diff check fails, fall back to file-modifying tool usage heuristic
                logger.warn({ err }, `${this.logPrefix} Git diff check failed`);
                if (this.hasFileModifyingToolCalls) {
                  // File-modifying tools were used — likely implemented
                  logger.info(
                    `${this.logPrefix} Git diff failed but file-modifying tools were used, setting status to completed`,
                  );
                  this.status = 'completed';
                  resolve({
                    success: true,
                    output: this.outputBuffer,
                    artifacts,
                    commits,
                    executionTimeMs,
                    waitingForInput: false,
                    claudeSessionId: this.claudeSessionId || undefined,
                  });
                } else {
                  // No file-modifying tools used — treat as failure
                  logger.info(
                    `${this.logPrefix} Git diff failed and no file-modifying tools used, setting status to failed`,
                  );
                  this.status = 'failed';
                  resolve({
                    success: false,
                    output: this.outputBuffer,
                    artifacts,
                    commits,
                    executionTimeMs,
                    waitingForInput: false,
                    claudeSessionId: this.claudeSessionId || undefined,
                    errorMessage:
                      'Could not verify agent execution results. Code changes cannot be confirmed.',
                  });
                }
              });
          };

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
          cleanupTimeoutCheck();
          cleanupIdleCheck();
          cleanupPromptFile();
          if (this.process?.pid) {
            unregisterProcess(this.process.pid);
          }
          this.status = 'failed';
          logger.error({ err: error }, `${this.logPrefix} Process error`);
          this.emitOutput(`${this.logPrefix} Error: ${error.message}\n`, true);

          // Build a detailed error message
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
        // NOTE: This catch block handles errors before spawn, so idleCheckInterval is not yet set
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

    const isWindows = process.platform === 'win32';

    if (isWindows) {
      // On Windows, use taskkill to terminate the process tree
      try {
        const pid = this.process.pid;
        if (pid) {
          const { execSync } = require('child_process');
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
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

      const isWindows = process.platform === 'win32';

      if (isWindows) {
        // On Windows, force-kill the process tree via taskkill
        try {
          const pid = this.process.pid;
          if (pid) {
            const { execSync } = require('child_process');
            // /T terminates the entire process tree, /F forces termination
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
            logger.info(`${this.logPrefix} Process ${pid} killed via taskkill`);
          }
        } catch (e) {
          logger.error({ err: e }, `${this.logPrefix} taskkill failed`);
          // Fall back to standard kill
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
    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      const baseClaudePath = process.env.CLAUDE_CODE_PATH || (isWindows ? 'claude.cmd' : 'claude');
      const claudePath = resolveCliPath(baseClaudePath);
      const proc = spawn(claudePath, ['--version'], { shell: true });

      // 10-second timeout
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

  /**
   * Check whether there are any code changes in the working directory.
   * Examines unstaged changes, staged changes, and recent commits.
   */
  private async checkGitDiff(workDir: string): Promise<boolean> {
    const runGitCommand = (args: string[]): Promise<string> => {
      return new Promise((resolve, reject) => {
        const proc = spawn('git', args, {
          cwd: workDir,
          shell: true,
        });

        let output = '';
        const timeout = setTimeout(() => {
          proc.kill();
          reject(new Error(`git ${args.join(' ')} timed out`));
        }, 5000);

        proc.stdout?.on('data', (data: Buffer) => {
          output += data.toString();
        });

        proc.on('close', () => {
          clearTimeout(timeout);
          resolve(output.trim());
        });

        proc.on('error', (err) => {
          clearTimeout(timeout);
          reject(new Error(`git ${args.join(' ')} failed: ${err.message}`));
        });
      });
    };

    // 0. Verify this is a git repository
    const revParse = await runGitCommand(['rev-parse', '--is-inside-work-tree']);
    if (revParse !== 'true') {
      throw new Error(`workDir is not a git repository: ${workDir}`);
    }

    // 1. unstaged changes
    const unstaged = await runGitCommand(['diff', '--stat', 'HEAD']);
    if (unstaged.length > 0) {
      logger.info(`${this.logPrefix} Git diff check: unstaged changes found`);
      return true;
    }

    // 2. staged changes
    const staged = await runGitCommand(['diff', '--cached', '--stat']);
    if (staged.length > 0) {
      logger.info(`${this.logPrefix} Git diff check: staged changes found`);
      return true;
    }

    // 3. Check git status (agent may have committed already)
    const status = await runGitCommand(['status', '--porcelain']);
    if (status.length > 0) {
      logger.info(`${this.logPrefix} Git diff check: working tree changes found`);
      return true;
    }

    // 4. Check for commits made during execution (within the last 5 minutes)
    const recentCommit = await runGitCommand(['log', '--oneline', '--since=5.minutes.ago', '-1']);
    if (recentCommit.length > 0) {
      logger.info(`${this.logPrefix} Git diff check: recent commit found: ${recentCommit}`);
      return true;
    }

    logger.info(`${this.logPrefix} Git diff check: no changes detected`);
    return false;
  }

  async validateConfig(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Check if Claude CLI is available
    const available = await this.isAvailable();
    if (!available) {
      errors.push('Claude Code CLI is not installed or not available in PATH');
    }

    // Validate the working directory
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
   * Build a structured prompt from AI task analysis results.
   * Formats task information for easy consumption by AI agents.
   */
  private buildStructuredPrompt(task: AgentTask): string {
    // CRITICAL: Determine working directory first to include in prompt
    const workDir = task.workingDirectory || this.config.workingDirectory || getProjectRoot();

    // Use optimized prompt if available (generated by PromptOptimizationPanel)
    if (task.optimizedPrompt) {
      logger.info(
        `${this.logPrefix} Using optimized prompt (${task.optimizedPrompt.length} chars)`,
      );
      // Prepend working directory instruction to optimized prompt
      return `**CRITICAL: You MUST work in this directory ONLY: ${workDir}**\n**DO NOT modify files outside this directory.**\n\n${task.optimizedPrompt}`;
    }

    const analysis = task.analysisInfo;

    if (!analysis) {
      // No analysis — fall back to a simple prompt with workflow instructions appended
      const basePrompt = task.description || task.title;
      const workflowInstructions = [
        `\n\n## Working Directory`,
        `**CRITICAL: You MUST work in this directory ONLY: ${workDir}**`,
        `**DO NOT modify files outside this directory.**`,
        ``,
        `## Workflow Steps`,
        `Please execute the task in the following order:`,
        `1. Research → Save research.md`,
        `2. If unclear points exist, save question.md + AskUserQuestion`,
        `3. Create and save plan.md → **Stop implementation and wait for approval**`,
        `4. Implement after approval`,
        `5. Save verify.md`,
        ``,
        `**ファイル保存API**: \`curl -X PUT http://localhost:${process.env.PORT || '3001'}/workflow/tasks/${task.id}/files/{research|question|plan|verify} -H 'Content-Type: application/json' -d '{"content":"..."}\`\``,
        ``,
        `**Important Notes**:`,
        `- Do not use plan mode (EnterPlanMode), implement code directly. Do not stop at planning, make sure to complete file creation and editing.`,
        `- **Never create files in the project root. Temporary files are no exception.**`,
        `- All workflow-related files (research/question/plan/verify) must be saved via the above API.`,
        `- File creation in project root using Write tool or Bash tool (mkdir/echo) is prohibited.`,
        `- **Do not create temporary files like implementation_*.md, temp_*.md, *_content.json, etc.**`,
      ].join('\n');
      return basePrompt + workflowInstructions;
    }

    // Priority label mapping
    const priorityLabels: Record<string, string> = {
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      urgent: 'Urgent',
    };

    // Complexity label mapping
    const complexityLabels: Record<string, string> = {
      simple: 'Simple',
      medium: 'Medium',
      complex: 'Complex',
    };

    const sections: string[] = [];
    sections.push('# Task Implementation Instructions');
    sections.push('');

    sections.push('## Working Directory');
    sections.push(`**CRITICAL: You MUST work in this directory ONLY: ${workDir}**`);
    sections.push(`**DO NOT modify files outside this directory.**`);
    sections.push(
      `**All file operations (Read, Write, Bash commands) must target files within: ${workDir}**`,
    );
    sections.push('');

    sections.push('## Overview');
    sections.push(`**Task Name:** ${task.title}`);
    sections.push(`**Analysis Summary:** ${analysis.summary}`);
    sections.push(
      `**Complexity:** ${complexityLabels[analysis.complexity] || analysis.complexity}`,
    );
    sections.push(`**Estimated Total Hours:** ${analysis.estimatedTotalHours} hours`);
    sections.push('');

    // Include original task description if available
    if (task.description) {
      sections.push('## Task Details');
      sections.push(task.description);
      sections.push('');
    }

    // Subtask list (implementation steps)
    if (analysis.subtasks && analysis.subtasks.length > 0) {
      sections.push('## Implementation Steps');
      sections.push('Please implement the task in the following order:');
      sections.push('');

      // Sort by order to respect dependency ordering
      const sortedSubtasks = [...analysis.subtasks].sort((a, b) => a.order - b.order);

      for (const subtask of sortedSubtasks) {
        const priorityLabel = priorityLabels[subtask.priority] || subtask.priority;
        sections.push(`### ${subtask.order}. ${subtask.title}`);
        sections.push(`- **Description:** ${subtask.description}`);
        sections.push(`- **Estimated Hours:** ${subtask.estimatedHours} hours`);
        sections.push(`- **Priority:** ${priorityLabel}`);

        if (subtask.dependencies && subtask.dependencies.length > 0) {
          const depTitles = subtask.dependencies
            .map((depOrder) => {
              const dep = analysis.subtasks.find((s) => s.order === depOrder);
              return dep ? `${depOrder}. ${dep.title}` : `Step ${depOrder}`;
            })
            .join(', ');
          sections.push(`- **Dependencies:** Execute after completion of ${depTitles}`);
        }
        sections.push('');
      }
    }

    // Analysis reasoning
    if (analysis.reasoning) {
      sections.push('## Implementation Approach Rationale');
      sections.push(analysis.reasoning);
      sections.push('');
    }

    // Implementation tips
    if (analysis.tips && analysis.tips.length > 0) {
      sections.push('## Implementation Hints');
      for (const tip of analysis.tips) {
        sections.push(`- ${tip}`);
      }
      sections.push('');
    }

    // Workflow instructions
    sections.push('## Workflow Steps');
    sections.push('Please execute the task while creating workflow files in the following steps:');
    sections.push('');
    sections.push('1. **Research**: Investigate the codebase and save results as research.md');
    sections.push(
      '2. **Questions**: If there are unclear points, save as question.md and ask with AskUserQuestion.',
    );
    sections.push(
      '   - **Important**: Prefer multiple-choice questions (2-4 options) for better user experience',
    );
    sections.push(
      '   - Format: "Question text\\nOptions:\\nA) Option 1\\nB) Option 2\\nC) Option 3"',
    );
    sections.push('   - Skip questions only if requirements are completely clear');
    sections.push(
      '3. **Planning**: Create and save plan.md reflecting research results and answers. **After saving plan.md, stop implementation here and wait for approval**',
    );
    sections.push(
      '4. **Implementation**: Implement after user approves the plan (do not ask questions at this stage)',
    );
    sections.push('5. **Verification**: Save implementation results as verify.md');
    sections.push('');
    sections.push('### How to Save Workflow Files');
    sections.push(
      '**Important**: Workflow files must be saved using the following API. Do not create them directly on the filesystem with mkdir/Write etc.',
    );
    sections.push('');
    sections.push('**Prohibited Actions**:');
    sections.push(
      '- **Never create files in the project root. Temporary files are no exception.**',
    );
    sections.push(
      '- File creation in project root using Write tool or Bash tool (mkdir/echo) is prohibited.',
    );
    sections.push(
      '- **Do not create temporary files like implementation_*.md, temp_*.md, *_content.json, etc.**',
    );
    sections.push('');
    sections.push('```bash');
    sections.push(`# Save research.md`);
    sections.push(
      `curl -X PUT http://localhost:${process.env.PORT || '3001'}/workflow/tasks/${task.id}/files/research -H 'Content-Type: application/json' -d '{"content":"# Research Results\\n..."}'`,
    );
    sections.push('');
    sections.push(`# Save question.md`);
    sections.push(
      `curl -X PUT http://localhost:${process.env.PORT || '3001'}/workflow/tasks/${task.id}/files/question -H 'Content-Type: application/json' -d '{"content":"# Unclear Points\\n..."}'`,
    );
    sections.push('');
    sections.push(`# Save plan.md`);
    sections.push(
      `curl -X PUT http://localhost:${process.env.PORT || '3001'}/workflow/tasks/${task.id}/files/plan -H 'Content-Type: application/json' -d '{"content":"# Implementation Plan\\n..."}'`,
    );
    sections.push('');
    sections.push(`# Save verify.md`);
    sections.push(
      `curl -X PUT http://localhost:${process.env.PORT || '3001'}/workflow/tasks/${task.id}/files/verify -H 'Content-Type: application/json' -d '{"content":"# Verification Report\\n..."}'`,
    );
    sections.push('```');
    sections.push('');

    // Execution instructions
    sections.push('## Execution Instructions');
    sections.push('Please implement the task from start to finish following the above steps.');
    sections.push('After completing each step, proceed to the next step.');
    sections.push('If you have unclear points, please ask questions.');
    sections.push('');
    sections.push('## Important Notes');
    sections.push(
      `- **CRITICAL: You MUST work ONLY in ${workDir}. DO NOT modify files outside this directory.**`,
    );
    sections.push(
      `- **Verify file paths before any operation. All paths must be within ${workDir}.**`,
    );
    sections.push('- **Do not use plan mode (EnterPlanMode).** Implement code directly.');
    sections.push('- Do not stop at planning, make sure to complete file creation and editing.');
    sections.push('- **Never create files in the project root.**');
    sections.push(
      '- All workflow-related files, including temporary files, must be saved via the above API.',
    );
    sections.push('- File creation using Write tool or Bash tool (mkdir/echo) is prohibited.');
    sections.push('- Use Write, Edit, and other tools to actually change the code.');

    return sections.join('\n');
  }

  /**
   * Extract question info from AskUserQuestion tool input.
   * Parses question text and details from stream-json AskUserQuestion tool calls.
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

    // Array format: questions field
    if (input.questions && Array.isArray(input.questions)) {
      const questions = input.questions as Array<{
        question?: string;
        header?: string;
        options?: Array<{ label: string; description?: string }>;
        multiSelect?: boolean;
      }>;

      // Extract question text
      questionText = questions
        .map((q) => q.question || q.header || '')
        .filter((q) => q)
        .join('\n');

      // Extract headers
      const headers = questions.map((q) => q.header).filter((h): h is string => !!h);
      if (headers.length > 0) {
        questionDetails.headers = headers;
      }

      // Get options and multiSelect from the first question
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
    }
    // Single question field format
    else if (input.question && typeof input.question === 'string') {
      questionText = input.question;
    }

    // Return questionDetails only if non-empty
    const hasDetails =
      questionDetails.headers?.length ||
      questionDetails.options?.length ||
      questionDetails.multiSelect !== undefined;

    return {
      questionText,
      questionDetails: hasDetails ? questionDetails : undefined,
    };
  }
}
