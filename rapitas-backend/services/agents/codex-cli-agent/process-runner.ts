/**
 * CodexCliAgent — Process Runner
 *
 * Handles spawning the Codex CLI child process, managing idle/timeout intervals,
 * wiring stdout/stderr/close event handlers, and resolving the execution promise.
 * JSON event processing is delegated to json-event-handler.ts. CLI argument/env
 * construction is delegated to process-runner-args.ts, and close-result/success
 * determination is delegated to process-runner-close-result.ts. Timers, the
 * stdout line handler and the close handler live in process-timers.ts,
 * stdout-line-handler.ts and process-close-handler.ts.
 * Not responsible for prompt building or artifact parsing.
 */

import { spawnLowPriority } from '../process-priority';
import type { ChildProcess } from 'child_process';
import type { AgentExecutionResult, AgentArtifact, GitCommitInfo } from '../base-agent';
import type { QuestionWaitingState } from '../question-detection';
import { createLogger } from '../../../config/logger';
import type { CodexCliAgentConfig } from './types';
import { resolveCliPath } from './types';
import { filterCliDiagnosticOutput } from '../cli-output-filter';
import { buildCodexArgs, buildSpawnCommand, buildProcessEnv } from './process-runner-args';
import { registerProcess } from '../agent-process-tracker';
import { startResourceSampling } from '../process-resource-sampler';
import { formatPromptPreview } from '../../../utils/agent/prompt-preview';
import { createSelfVerificationReporter } from '../../workflow/self-verification-activity/activity-reporter';
import { createProcessTimers } from './process-timers';
import { createStdoutLineHandler } from './stdout-line-handler';
import { createCodexCloseHandler } from './process-close-handler';

const logger = createLogger('codex-cli-agent/process-runner');

/** Callbacks the runner needs from the owning agent. */
export type ProcessRunnerCallbacks = {
  emitOutput: (text: string, isError?: boolean) => void;
  emitQuestionDetected: (payload: {
    question: string;
    questionType: import('../base-agent').QuestionType;
    questionDetails: import('../question-detection').QuestionDetails | undefined;
    questionKey: import('../question-detection').QuestionKey | undefined;
  }) => void;
  onSessionId: (sessionId: string) => void;
  onQuestionDetected: (state: QuestionWaitingState) => void;
  onStatusChange: (status: string) => void;
  logPrefix: string;
};

/** Mutable state shared between the runner and the agent class. */
export type ProcessRunnerState = {
  cancelRequested?: boolean;
  process: ChildProcess | null;
  outputBuffer: string;
  errorBuffer: string;
  lineBuffer: string;
  detectedQuestion: QuestionWaitingState;
  activeTools: Map<string, { name: string; startTime: number; info: string }>;
  codexSessionId: string | null;
  actualModel: string | null;
  status: string;
  turnFailed: boolean;
  turnFailureMessage: string | null;
  activeCodexCommands: Map<string, { command: string; startedAt: number }>;
  seenAgentMessageIds: Set<string>;
};

/**
 * Ensure output directory exists before spawn.
 */
async function ensureOutputDirectory(outputPath: string | undefined): Promise<void> {
  if (!outputPath) return;

  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
  } catch {
    // Best-effort; spawn may still succeed if dir exists
  }
}

/**
 * Spawn the Codex CLI process and wire up all event handlers.
 * Resolves with an AgentExecutionResult when the process exits.
 */
export async function spawnCodexProcess(
  config: CodexCliAgentConfig,
  workDir: string,
  prompt: string,
  state: ProcessRunnerState,
  callbacks: ProcessRunnerCallbacks,
  startTime: number,
  parseArtifacts: (output: string) => AgentArtifact[],
  parseCommits: (output: string) => GitCommitInfo[],
): Promise<AgentExecutionResult> {
  const { logPrefix } = callbacks;
  const timeout = config.timeout ?? 900000;

  // Ensure output directory exists
  await ensureOutputDirectory(config.outputLastMessageFile);

  const isWindows = process.platform === 'win32';
  const codexPath = await resolveCliPath(
    process.env.CODEX_CLI_PATH || (isWindows ? 'codex.cmd' : 'codex'),
  );

  if (state.cancelRequested)
    return {
      success: false,
      output: state.outputBuffer,
      errorMessage: 'Execution cancelled',
      executionTimeMs: Date.now() - startTime,
      failureType: 'cancelled',
    };
  return new Promise((resolve) => {
    // Build CLI arguments
    const { args, promptForStdin } = buildCodexArgs(config, workDir, prompt, logPrefix);

    const argsForLog = args.map((a, i) =>
      i === args.length - 1 && a.length > 100 ? `<prompt:${a.length}chars>` : a,
    );
    logger.info(
      `${logPrefix} Platform: ${process.platform}, Codex: ${codexPath}, Timeout: ${timeout}ms, Prompt: ${prompt.length} chars`,
    );
    logger.info(`${logPrefix} Spawn argv: ${JSON.stringify([codexPath, ...argsForLog])}`);
    logger.info(`${logPrefix} Spawn cwd: ${workDir}`);

    callbacks.emitOutput(`${logPrefix} Starting execution...\n`);
    callbacks.emitOutput(`${logPrefix} Model: ${config.model ?? 'default'}\n`);
    callbacks.emitOutput(`${logPrefix} Working directory: ${workDir}\n`);
    callbacks.emitOutput(`${logPrefix} Timeout: ${timeout / 1000}s\n`);
    // One line only — untagged continuation lines render as agent narrative (formatPromptPreview).
    callbacks.emitOutput(`${logPrefix} Prompt: ${formatPromptPreview(prompt)}\n\n`);

    try {
      const [finalCommand, finalArgs] = buildSpawnCommand(codexPath, args, isWindows);
      const env = buildProcessEnv(config, isWindows);

      // Output callbacks can synchronously request stop while announcing startup.
      if (state.cancelRequested) {
        resolve({
          success: false,
          output: state.outputBuffer,
          errorMessage: 'Execution cancelled',
          executionTimeMs: Date.now() - startTime,
          failureType: 'cancelled',
        });
        return;
      }
      state.process = spawnLowPriority(finalCommand, finalArgs, {
        cwd: workDir,
        shell: true,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });

      if (state.process.stdout) state.process.stdout.setEncoding('utf8');
      if (state.process.stderr) state.process.stderr.setEncoding('utf8');

      logger.info(`${logPrefix} Process spawned with PID: ${state.process.pid}`);
      callbacks.emitOutput(`${logPrefix} Process PID: ${state.process.pid}\n`);

      // Track the PID so a crash of the parent backend (or a hung codex
      // process outliving its own timeout) can still be found and reaped by
      // dev.js's startup cleanup / cleanupZombieProcesses — previously ONLY
      // claude-execution-runner.ts's spawn registered here, so codex CLI
      // processes were invisible to the zombie sweep (and not `bun.exe`, so
      // killStrayBunProcesses' name-based scan misses them too).
      if (state.process.pid) {
        registerProcess({
          pid: state.process.pid,
          role: 'cli-agent',
          startedAt: new Date().toISOString(),
          parentPid: process.pid,
        });
        startResourceSampling(state.process.pid);
      }

      // Write prompt to stdin for investigation mode
      if (state.process.stdin) {
        if (promptForStdin) {
          try {
            state.process.stdin.setDefaultEncoding('utf8');
            state.process.stdin.write(promptForStdin);
          } catch (writeErr) {
            logger.warn(
              { err: writeErr },
              `${logPrefix} Failed to write prompt body to codex stdin`,
            );
          }
        }
        state.process.stdin.end();
      }

      state.lineBuffer = '';

      // NOTE: Task 1582 — holds the no-output timeout while self-verification
      // runs in this worktree and shows its waiting/result lines (display only).
      const selfVerification = createSelfVerificationReporter({
        workDir,
        executionStartedAt: startTime,
        emit: (line) => callbacks.emitOutput(line),
      });

      // Setup process timers
      const timers = createProcessTimers(state, callbacks, startTime, timeout, resolve, {
        selfVerification,
      });
      const parseStdoutLine = createStdoutLineHandler(config, state, callbacks);
      const handleStdoutLine = (line: string) => {
        // close時の残り行も含め、完了出力より先に自己検証の状態を通知する。
        selfVerification.tick();
        parseStdoutLine(line);
      };

      // Handle stdout
      state.process.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        state.lineBuffer += chunk;
        timers.updateLastOutputTime();
        timers.markOutputReceived();

        const lines = state.lineBuffer.split('\n');
        state.lineBuffer = lines.pop() || '';
        for (const line of lines) handleStdoutLine(line);
      });

      // Handle stderr
      state.process.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        state.errorBuffer += output;
        timers.updateLastOutputTime();

        const modelMatch = output.match(/(?:^|\n)model:\s*([^\r\n]+)/i);
        if (modelMatch?.[1]) state.actualModel = modelMatch[1].trim();

        const filtered = filterCliDiagnosticOutput(output, { provider: 'codex' });
        if (filtered.display) {
          state.outputBuffer += filtered.display;
          callbacks.emitOutput(filtered.display, filtered.important);
        }
      });

      // Handle close
      const onClose = createCodexCloseHandler({
        config,
        workDir,
        state,
        callbacks,
        startTime,
        timers,
        handleStdoutLine,
        argsForLog,
        parseArtifacts,
        parseCommits,
        resolve,
        selfVerification,
      });
      state.process.on('close', (code: number | null) => {
        onClose(code).catch((err) => {
          logger.error({ err }, `${logPrefix} close handler failed`);
        });
      });

      // Handle error
      state.process.on('error', (error: Error) => {
        timers.cleanupTimeout();
        timers.cleanupIdle();
        state.status = 'failed';
        callbacks.onStatusChange('failed');
        logger.error({ err: error }, `${logPrefix} Process error`);
        callbacks.emitOutput(`${logPrefix} Error: ${error.message}\n`, true);

        const parts = [`プロセス起動エラー: ${error.message}`];
        if (state.errorBuffer.trim())
          parts.push(`\n\n【標準エラー出力】\n${state.errorBuffer.trim()}`);

        resolve({
          success: false,
          output: state.outputBuffer,
          errorMessage: parts.join(''),
          executionTimeMs: Date.now() - startTime,
        });
      });
    } catch (error) {
      state.status = 'failed';
      callbacks.onStatusChange('failed');
      logger.error({ err: error }, `${logPrefix} Spawn error`);
      resolve({
        success: false,
        output: '',
        errorMessage: error instanceof Error ? error.message : String(error),
        executionTimeMs: Date.now() - startTime,
      });
    }
  });
}
