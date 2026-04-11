/**
 * SubAgentProcessManager
 *
 * The SubAgent class wraps the Claude CLI child process for one task execution.
 * Responsible for: spawning the process, piping stdin/stdout, accumulating output,
 * and resolving the execution promise. JSON parsing is delegated to OutputParser;
 * CLI argument construction is delegated to SpawnConfig.
 */
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { writeFileSync, appendFileSync, existsSync, statSync } from 'fs';
import { createLogger } from '../../../config/logger';
import type { SubAgentState, ParallelExecutionStatus } from '../types-dir/types';
import type { AgentTask, AgentExecutionResult } from '../../agents/base-agent';
import { getLogFilePath } from './log-utils';
import { buildPrompt } from './prompt-builder';
import { buildSpawnSpec } from './spawn-config';
import { OutputParser } from './output-parser';

const logger = createLogger('sub-agent-controller');

/** Configuration passed to each SubAgent instance. */
export type SubAgentConfig = {
  agentId: string;
  taskId: number;
  executionId: number;
  workingDirectory: string;
  timeout: number;
  dangerouslySkipPermissions: boolean;
  state: SubAgentState;
};

/**
 * Manages the lifecycle of a single Claude CLI subprocess for one sub-task.
 *
 * Emits:
 * - `output` (chunk: string, isError: boolean) — new output available
 * - `question_detected` ({ question, questionDetails }) — AskUserQuestion detected
 */
export class SubAgent extends EventEmitter {
  readonly config: SubAgentConfig;
  private process: ChildProcess | null = null;
  private state: SubAgentState;
  private outputBuffer: string = '';
  private lineBuffer: string = '';
  private logFilePath: string;
  private fileWatchInterval: NodeJS.Timeout | null = null;
  private lastFileSize: number = 0;
  private parser: OutputParser | null = null;

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
    this.logFilePath = getLogFilePath(config.taskId, config.executionId);
  }

  /**
   * Return the path to this agent's log file.
   *
   * @returns Absolute log file path / ログファイルの絶対パス
   */
  getLogFilePath(): string {
    return this.logFilePath;
  }

  /**
   * Execute the task by spawning the Claude CLI, writing the prompt to stdin,
   * and resolving when the process exits or when AskUserQuestion is detected.
   *
   * @param task - Task to execute / 実行するタスク
   * @returns Execution result / 実行結果
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

    // NOTE: Build prompt before entering the Promise constructor (async → sync boundary)
    const prompt = await buildPrompt(this.config.agentId, task);

    // Create a fresh OutputParser for this execution
    this.parser = new OutputParser({
      onDisplayOutput: (text) => {
        this.outputBuffer += text;
        this.state.output += text;
        this.emit('output', text, false);
      },
      onSessionId: (_id) => {
        // sessionId is read from parser.sessionId after process close
      },
      onQuestionDetected: (question, details) => {
        this.state.status = 'waiting_for_input';
        this.emit('question_detected', { question, questionDetails: details });
      },
      onKillProcess: () => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGTERM');
        }
      },
    });

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
        const spawnSpec = buildSpawnSpec(
          this.config.agentId,
          task,
          this.config.dangerouslySkipPermissions,
        );

        logger.info(`[SubAgent ${this.config.agentId}] Command: ${spawnSpec.command}`);
        logger.info(
          `[SubAgent ${this.config.agentId}] Working directory: ${this.config.workingDirectory}`,
        );
        logger.info(`[SubAgent ${this.config.agentId}] Prompt length: ${prompt.length} chars`);

        this.process = spawn(spawnSpec.command, spawnSpec.args, {
          cwd: this.config.workingDirectory,
          shell: true,
          windowsHide: true, // NOTE: Prevents TCP handle inheritance — stops CLI process from inheriting port 3001 socket
          stdio: ['pipe', 'pipe', 'pipe'],
          env: spawnSpec.env,
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

        // Write prompt to stdin in 16 KB chunks to avoid backpressure stalls
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

        // Poll log file every 500 ms so the UI receives incremental updates
        this.fileWatchInterval = setInterval(() => {
          this.readNewOutputFromFile();
        }, 500);

        const maxExecutionTime = this.config.timeout * 6; // Default 5 min timeout * 6 = 30 min
        timeoutCheckInterval = setInterval(() => {
          const now = Date.now();
          const elapsedTime = now - startTime;
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
            this.parser?.parseLine(line, this.config.agentId);
          }
        });

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

          const waitingForInput = this.parser?.waitingForInput ?? false;

          if (waitingForInput) {
            const detectedQuestion = this.parser?.detectedQuestion ?? null;
            const questionDetails = this.parser?.questionDetails ?? null;
            const claudeSessionId = this.parser?.sessionId ?? null;

            logger.info(
              `[SubAgent ${this.config.agentId}] Setting status to waiting_for_input (question detected)`,
            );
            logger.info(
              `[SubAgent ${this.config.agentId}] Question: ${detectedQuestion?.substring(0, 200)}`,
            );
            logger.info(
              `[SubAgent ${this.config.agentId}] Session ID for resume: ${claudeSessionId}`,
            );
            this.state.status = 'waiting_for_input';
            this.state.watingForInput = true;
            this.appendToLogFile(`\n[WAITING] 回答を待っています...\n`);
            resolve({
              success: true, // Technically successful but not complete — waiting for user input
              output: this.state.output,
              tokensUsed: this.state.tokensUsed,
              executionTimeMs: this.state.executionTimeMs,
              claudeSessionId: claudeSessionId || undefined,
              waitingForInput: true,
              question: detectedQuestion || undefined,
              questionDetails: questionDetails || undefined,
            });
            return;
          }

          const claudeSessionId = this.parser?.sessionId ?? null;

          if (code === 0) {
            this.state.status = 'completed';
            resolve({
              success: true,
              output: this.state.output,
              tokensUsed: this.state.tokensUsed,
              executionTimeMs: this.state.executionTimeMs,
              claudeSessionId: claudeSessionId || undefined,
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

  /** Append raw content to the task log file without throwing on I/O errors. */
  private appendToLogFile(content: string): void {
    try {
      appendFileSync(this.logFilePath, content);
    } catch (error) {
      logger.error({ err: error }, `[SubAgent ${this.config.agentId}] Failed to write to log file`);
    }
  }

  /**
   * Read newly appended bytes from the log file and emit them as output events.
   * Called both on a 500 ms interval and once on process close.
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
          this.emit('output', newContent, false);
        }

        this.lastFileSize = stat.size;
      }
    } catch (_error) {}
  }

  /** Kill the child process and mark this agent as cancelled. */
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
   * Return a snapshot of the current agent state.
   *
   * @returns Immutable copy of current state / 現在の状態のコピー
   */
  getState(): SubAgentState {
    return { ...this.state };
  }

  /**
   * Return the current execution status.
   *
   * @returns Status string / ステータス文字列
   */
  getStatus(): ParallelExecutionStatus {
    return this.state.status;
  }
}
