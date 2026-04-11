/**
 * CodexCliAgent
 *
 * Spawns OpenAI Codex CLI as a child process to execute tasks.
 * Delegates prompt building, output parsing, and process management to sub-modules.
 *
 * Codex CLI: @openai/codex (npm install -g @openai/codex)
 * https://github.com/openai/codex
 */

import { spawn, execSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import { BaseAgent } from '../base-agent';
import type { AgentCapability, AgentTask, AgentExecutionResult } from '../base-agent';
import { createInitialWaitingState } from '../question-detection';
import type { QuestionWaitingState } from '../question-detection';
import { createLogger } from '../../../config/logger';
import { getProjectRoot } from '../../../config';
import type { CodexCliAgentConfig } from './types';
import { resolveCliPath } from './types';
import { buildStructuredPrompt } from './prompt-builder';
import { parseArtifacts, parseCommits } from './output-parser';
import { spawnCodexProcess } from './process-runner';
import type { ProcessRunnerState } from './process-runner';

export type { CodexCliAgentConfig } from './types';

const logger = createLogger('codex-cli-agent');

/** @internal Re-export for convenience */
export { resolveCliPath };

export class CodexCliAgent extends BaseAgent {
  private process: ChildProcess | null = null;
  private config: CodexCliAgentConfig;
  private outputBuffer: string = '';
  private errorBuffer: string = '';
  private lineBuffer: string = '';
  private detectedQuestion: QuestionWaitingState = createInitialWaitingState();
  private activeTools: Map<string, { name: string; startTime: number; info: string }> = new Map();
  private codexSessionId: string | null = null;

  constructor(id: string, name: string, config: CodexCliAgentConfig = {}) {
    super(id, name, 'codex');
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

  async execute(
    task: AgentTask,
    _options?: Record<string, unknown>,
  ): Promise<AgentExecutionResult> {
    this.status = 'running';
    this.outputBuffer = '';
    this.errorBuffer = '';
    this.lineBuffer = '';
    this.detectedQuestion = createInitialWaitingState();
    this.activeTools.clear();
    this.codexSessionId = null;
    const startTime = Date.now();

    const fs = await import('fs/promises');
    const workDir = task.workingDirectory || this.config.workingDirectory || getProjectRoot();

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
    } catch {
      this.status = 'failed';
      return {
        success: false,
        output: '',
        errorMessage: `Working directory does not exist: ${workDir}`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const isCodexAvailable = await this.isAvailable();
    if (!isCodexAvailable) {
      this.status = 'failed';
      return {
        success: false,
        output: '',
        errorMessage: `Codex CLI not found. Please install it with: npm install -g @openai/codex`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const prompt = this.buildPrompt(task);

    logger.info(`${this.logPrefix} Using ${task.analysisInfo ? 'structured' : 'simple'} prompt`);
    if (task.analysisInfo) {
      logger.info(`${this.logPrefix} Analysis complexity: ${task.analysisInfo.complexity}`);
      logger.info(`${this.logPrefix} Subtasks count: ${task.analysisInfo.subtasks?.length || 0}`);
    }

    // Build a shared state object so process-runner can mutate it
    const runnerState: ProcessRunnerState = {
      process: null,
      outputBuffer: this.outputBuffer,
      errorBuffer: this.errorBuffer,
      lineBuffer: this.lineBuffer,
      detectedQuestion: this.detectedQuestion,
      activeTools: this.activeTools,
      codexSessionId: this.codexSessionId,
      status: this.status,
    };

    // Extend config with task-level resumeSessionId if provided
    const effectiveConfig: CodexCliAgentConfig = {
      ...this.config,
      resumeSessionId: this.config.resumeSessionId ?? task.resumeSessionId,
    };

    const result = await spawnCodexProcess(
      effectiveConfig,
      workDir,
      prompt,
      runnerState,
      {
        emitOutput: (text, isError) => this.emitOutput(text, isError),
        emitQuestionDetected: (payload) =>
          this.emitQuestionDetected({
            question: payload.question,
            questionType: payload.questionType,
            questionDetails: payload.questionDetails,
            questionKey: payload.questionKey,
          }),
        onSessionId: (id) => {
          this.codexSessionId = id;
        },
        onQuestionDetected: (state) => {
          this.detectedQuestion = state;
        },
        onStatusChange: (status) => {
          this.status = status as typeof this.status;
        },
        logPrefix: this.logPrefix,
      },
      startTime,
      parseArtifacts,
      parseCommits,
    );

    // Sync back mutable state from runner
    this.process = runnerState.process;
    this.outputBuffer = runnerState.outputBuffer;
    this.errorBuffer = runnerState.errorBuffer;
    this.lineBuffer = runnerState.lineBuffer;
    this.detectedQuestion = runnerState.detectedQuestion;
    this.codexSessionId = runnerState.codexSessionId;

    return result;
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.status = 'cancelled';
      this.emitOutput(`\n${this.logPrefix} Stopping execution...\n`);

      const isWindows = process.platform === 'win32';

      if (isWindows) {
        try {
          const pid = this.process.pid;
          if (pid) {
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
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
        this.process.kill('SIGINT');

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

  override async pause(): Promise<boolean> {
    if (this.process && this.status === 'running') {
      this.process.kill('SIGSTOP');
      this.status = 'paused';
      this.emitOutput(`\n${this.logPrefix} Execution paused\n`);
      return true;
    }
    return false;
  }

  override async resume(): Promise<boolean> {
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
      const codexPath = resolveCliPath(
        process.env.CODEX_CLI_PATH || (isWindows ? 'codex.cmd' : 'codex'),
      );
      const proc = spawn(codexPath, ['--version'], { shell: true });

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
        'Codex CLI is not installed or not available in PATH. Install with: npm install -g @openai/codex',
      );
    }

    if (this.config.apiKey) {
      logger.info(`${this.logPrefix} Using provided API key`);
    } else if (process.env.OPENAI_API_KEY) {
      logger.info(`${this.logPrefix} Using OPENAI_API_KEY from environment`);
    } else {
      logger.info(
        `${this.logPrefix} No API key provided - will use ChatGPT account authentication`,
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

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get the Codex session ID from the most recent execution.
   *
   * @returns Session ID string, or null if no session has been started / セッションIDまたはnull
   */
  getSessionId(): string | null {
    return this.codexSessionId;
  }

  /** Delegate to standalone buildStructuredPrompt with agent's log prefix. */
  private buildPrompt(task: AgentTask): string {
    return buildStructuredPrompt(task, this.logPrefix);
  }
}
