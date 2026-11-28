/**
 * claude-process-handlers
 *
 * The 'close' and 'error' handlers of the Claude Code CLI child process.
 * Split out of claude-execution-runner.ts (300-line threshold). The close
 * handler holds the resolve while self-verification is still running in the
 * worktree, so the run is not reported finished before the verdict is out.
 * Not responsible for spawning or for parsing output.
 */
import type { AgentExecutionResult } from '../base-agent';
import type { WorkerInputMessage } from '../../../workers/output-parser-types';
import { createLogger } from '../../../config/logger';
import { unregisterProcess } from '../agent-process-tracker';
import { scheduleAgentReap } from '../agent-reap';
import { stopResourceSampling } from '../process-resource-sampler';
import type { SelfVerificationReporter } from '../../workflow/self-verification-activity/activity-reporter';
import type { ClaudeCodeAgent } from './agent-core';

const logger = createLogger('claude-code-agent');

/** Agent state the handlers read and write. */
export type ProcessHandlerAgent = Pick<
  ClaudeCodeAgent,
  | 'process'
  | 'lineBuffer'
  | 'outputBuffer'
  | 'errorBuffer'
  | 'logPrefix'
  | 'parserWorker'
  | 'workerArtifacts'
  | 'workerCommits'
  | 'onParseComplete'
  | 'getStatus'
  | 'setStatusInternal'
  | 'emitOutputInternal'
>;

/** Resource figures handed to the resolver. */
type ResourceStats = { cpuTimeMs: number | null; peakRssKb: number | null };

/** Everything the handlers need from runClaudeExecution. */
export interface ProcessHandlerContext {
  agent: ProcessHandlerAgent;
  workDir: string;
  startTime: number;
  resolve: (result: AgentExecutionResult) => void;
  buildResolveAfterParse: (
    code: number | null,
    workDir: string,
    startTime: number,
    resolve: (result: AgentExecutionResult) => void,
    resourceStats?: ResourceStats,
  ) => () => void;
  monitor: { cleanup: () => void };
  cleanupPromptFile: () => void;
  reporter: SelfVerificationReporter;
}

function cancelledResult(agent: ProcessHandlerAgent, startTime: number): AgentExecutionResult {
  return {
    success: false,
    output: agent.outputBuffer,
    errorMessage: 'Execution cancelled',
    executionTimeMs: Date.now() - startTime,
    failureType: 'cancelled',
  };
}

/**
 * Build the child 'close' handler.
 *
 * @param ctx - Agent, resolvers and cleanup hooks / エージェント・解決関数・後始末
 * @returns Handler taking the exit code / 終了コードを受け取るハンドラ
 */
export function createCloseHandler(
  ctx: ProcessHandlerContext,
): (code: number | null) => Promise<void> {
  const { agent, workDir, startTime, resolve } = ctx;
  return async (code) => {
    ctx.monitor.cleanup();
    ctx.cleanupPromptFile();
    let resourceStats: ResourceStats = { cpuTimeMs: null, peakRssKb: null };
    if (agent.process?.pid) {
      const closedPid = agent.process.pid;
      unregisterProcess(closedPid);
      resourceStats = stopResourceSampling(closedPid);
      // On Windows, 'close' (stdio closed) does NOT guarantee the process
      // exited — a completed `claude --print` agent can stay resident and pile
      // up as a zombie. Reap its tree after a short grace if still alive.
      // killProcessTreeSafely refuses to touch a port-3001 (backend) process.
      // Capture descendants NOW, while the parent links are still live — a
      // command the agent launched can outlive both the agent and the shell
      // that started it, and is then unreachable from the root.
      // Also sweeps detached processes naming the task worktree (agent-reap.ts).
      scheduleAgentReap(closedPid, workDir);
    }
    const executionTimeMs = Date.now() - startTime;

    if (agent.lineBuffer.trim()) {
      logger.info(
        `${agent.logPrefix} Processing remaining lineBuffer: ${agent.lineBuffer.substring(0, 200)}`,
      );
      agent.outputBuffer += agent.lineBuffer + '\n';
      agent.emitOutputInternal(agent.lineBuffer + '\n');
    }

    logger.info(`${agent.logPrefix} Process closed with code: ${code}, time: ${executionTimeMs}ms`);
    logger.info(`${agent.logPrefix} Final output length: ${agent.outputBuffer.length}`);
    logger.info(`${agent.logPrefix} Last 500 chars of output: ${agent.outputBuffer.slice(-500)}`);
    if (agent.getStatus() === 'cancelled') {
      resolve({ ...cancelledResult(agent, startTime), executionTimeMs });
      return;
    }

    // Skip if already resolved by timeout
    if (agent.getStatus() === 'failed') return;

    // NOTE: Task 1582 — the CLI can end its turn while the self-verification
    // gate is still running. Resolving now records the run as finished and the
    // screen shows 「実行完了」 with no verdict, so wait for the result first.
    // The wait ends at the marker's limit (30 min) or on a stop request.
    if (ctx.reporter.isActive()) {
      logger.info(
        `${agent.logPrefix} CLI exited during self-verification — waiting for the result`,
      );
    }
    const settled = await ctx.reporter.waitUntilSettled({
      isCancelled: () => agent.getStatus() === 'cancelled',
    });
    if (settled === 'cancelled') {
      resolve(cancelledResult(agent, startTime));
      return;
    }

    const resolveAfterParse = ctx.buildResolveAfterParse(
      code,
      workDir,
      startTime,
      resolve,
      resourceStats,
    );

    // If a Worker exists, send parse-complete and wait for results;
    // otherwise fall back to direct execution
    if (agent.parserWorker) {
      agent.workerArtifacts = [];
      agent.workerCommits = [];
      agent.onParseComplete = resolveAfterParse;

      try {
        agent.parserWorker.postMessage({
          type: 'parse-complete',
          outputBuffer: agent.outputBuffer,
        } satisfies WorkerInputMessage);
      } catch (workerErr) {
        logger.warn(
          { errorDetail: workerErr instanceof Error ? workerErr.message : workerErr },
          `${agent.logPrefix} Worker postMessage failed on parse-complete, falling back`,
        );
        agent.onParseComplete = null;
        resolveAfterParse();
      }
    } else {
      resolveAfterParse();
    }
  };
}

/**
 * Build the child 'error' handler (spawn or runtime process error).
 *
 * @param ctx - Agent, resolvers and cleanup hooks / エージェント・解決関数・後始末
 * @returns Handler taking the error / エラーを受け取るハンドラ
 */
export function createErrorHandler(ctx: ProcessHandlerContext): (error: Error) => void {
  const { agent, startTime, resolve } = ctx;
  return (error) => {
    ctx.monitor.cleanup();
    ctx.cleanupPromptFile();
    if (agent.process?.pid) unregisterProcess(agent.process.pid);
    agent.setStatusInternal('failed');
    logger.error({ err: error }, `${agent.logPrefix} Process error`);
    agent.emitOutputInternal(`${agent.logPrefix} Error: ${error.message}\n`, true);

    const errorParts: string[] = [];
    errorParts.push(`Process startup error: ${error.message}`);
    if (agent.errorBuffer.trim()) {
      errorParts.push(`\n\n【Standard Error Output】\n${agent.errorBuffer.trim()}`);
    }
    if (agent.outputBuffer.trim()) {
      errorParts.push(`\n\n【Standard Output】\n${agent.outputBuffer.trim().slice(-500)}`);
    }

    resolve({
      success: false,
      output: agent.outputBuffer,
      errorMessage: errorParts.join(''),
      executionTimeMs: Date.now() - startTime,
    });
  };
}
