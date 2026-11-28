/**
 * CodexCliAgent — Process Close Handler
 *
 * The 'close' handler of the Codex CLI child process: reaps the tree, logs a
 * non-zero exit, and resolves the execution — after self-verification in the
 * worktree has a verdict. Split out of process-runner.ts (300-line threshold);
 * not responsible for spawning or for the success rules (process-runner-close-result.ts).
 */
import type { AgentArtifact, AgentExecutionResult, GitCommitInfo } from '../base-agent';
import { createLogger } from '../../../config/logger';
import { unregisterProcess } from '../agent-process-tracker';
import { scheduleAgentReap } from '../agent-reap';
import { stopResourceSampling } from '../process-resource-sampler';
import type { SelfVerificationReporter } from '../../workflow/self-verification-activity/activity-reporter';
import { buildCloseResult, isSuccessfulClose } from './process-runner-close-result';
import type { CodexCliAgentConfig } from './types';
import type { ProcessRunnerCallbacks, ProcessRunnerState } from './process-runner';
import type { ProcessTimers } from './process-timers';
import type { StdoutLineHandler } from './stdout-line-handler';

const logger = createLogger('codex-cli-agent/process-runner');

/** Inputs of {@link createCodexCloseHandler}. */
export interface CodexCloseContext {
  config: CodexCliAgentConfig;
  workDir: string;
  state: ProcessRunnerState;
  callbacks: ProcessRunnerCallbacks;
  startTime: number;
  timers: Pick<ProcessTimers, 'cleanupIdle' | 'cleanupTimeout'>;
  handleStdoutLine: StdoutLineHandler;
  argsForLog: string[];
  parseArtifacts: (output: string) => AgentArtifact[];
  parseCommits: (output: string) => GitCommitInfo[];
  resolve: (result: AgentExecutionResult) => void;
  selfVerification: Pick<SelfVerificationReporter, 'waitUntilSettled'>;
}

/**
 * Build the child 'close' handler.
 *
 * @param ctx - State, callbacks and resolvers of this run / この実行の状態・コールバック・解決関数
 * @returns Handler taking the exit code / 終了コードを受け取るハンドラ
 */
export function createCodexCloseHandler(
  ctx: CodexCloseContext,
): (code: number | null) => Promise<void> {
  const {
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
  } = ctx;
  const { logPrefix } = callbacks;
  return async (code) => {
    timers.cleanupTimeout();
    timers.cleanupIdle();
    const executionTimeMs = Date.now() - startTime;

    let resourceStats: { cpuTimeMs: number | null; peakRssKb: number | null } = {
      cpuTimeMs: null,
      peakRssKb: null,
    };
    if (state.process?.pid) {
      const closedPid = state.process.pid;
      unregisterProcess(closedPid);
      resourceStats = stopResourceSampling(closedPid);
      // On Windows, 'close' (stdio closed) does NOT guarantee the process
      // exited — mirrors claude-execution-runner.ts's same reap-after-grace.
      // killProcessTreeSafely refuses to touch a port-3001 (backend) process.
      // Capture descendants NOW, while the parent links are still live — a
      // command the agent launched can outlive both the agent and the shell
      // that started it, and is then unreachable from the root.
      // Also sweeps detached processes naming the task worktree (agent-reap.ts).
      scheduleAgentReap(closedPid, workDir);
    }

    // Process any remaining buffered line
    if (state.lineBuffer.trim()) {
      handleStdoutLine(state.lineBuffer);
    }

    logger.info(`${logPrefix} Closed with code: ${code}, time: ${executionTimeMs}ms`);

    // Log diagnostic for non-zero exit
    if (code !== null && code !== 0) {
      const stderrSample =
        state.errorBuffer?.length > 0 ? state.errorBuffer.slice(-4096) : '(stderr was empty)';
      logger.error(
        {
          exitCode: code,
          executionTimeMs,
          stderrTail: stderrSample,
          outputBufferLen: state.outputBuffer.length,
          argsForLog,
        },
        `${logPrefix} Codex CLI exited non-zero — full diagnostic`,
      );
      callbacks.emitOutput(
        `\n[Codex 終了コード ${code}] stderr (末尾4KB):\n${stderrSample}\n`,
        true,
      );
    }
    // Handle cancelled state
    if (state.cancelRequested || state.status === 'cancelled') {
      resolve({
        success: false,
        output: state.outputBuffer,
        errorMessage: 'Execution cancelled',
        executionTimeMs,
        failureType: 'cancelled',
      });
      return;
    }
    if (state.status === 'failed') return;

    // NOTE: Task 1582 — the CLI can exit while the self-verification gate is
    // still running; resolving now would report the run finished without a
    // verdict. Wait for the result (bounded by the marker's 30-min limit).
    const settled = await ctx.selfVerification.waitUntilSettled({
      isCancelled: () => !!state.cancelRequested || state.status === 'cancelled',
    });
    if (settled === 'cancelled') {
      resolve({
        success: false,
        output: state.outputBuffer,
        errorMessage: 'Execution cancelled',
        executionTimeMs: Date.now() - startTime,
        failureType: 'cancelled',
      });
      return;
    }

    // Build and return result
    const result = buildCloseResult(
      code,
      state,
      config,
      startTime,
      parseArtifacts,
      parseCommits,
      resourceStats,
    );

    if (result.waitingForInput) {
      state.status = 'waiting_for_input';
      callbacks.onStatusChange('waiting_for_input');
      callbacks.emitOutput(`\n${logPrefix} 回答を待っています...\n`);
    } else {
      const newStatus = isSuccessfulClose(code, state) ? 'completed' : 'failed';
      state.status = newStatus;
      callbacks.onStatusChange(newStatus);
    }

    resolve(result);
  };
}
