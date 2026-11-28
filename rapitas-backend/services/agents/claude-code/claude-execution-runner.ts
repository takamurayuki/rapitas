/**
 * claude-execution-runner
 *
 * The body of the Promise inside `ClaudeCodeAgent.execute()`. Spawns the
 * Claude Code CLI as a child process, wires up the output-parser Worker,
 * registers stdout/stderr/close/error handlers, and resolves the agent's
 * execute() promise.
 *
 * Extracted from agent-core.ts purely to keep that file under the
 * 500-line per-file limit. The function reads and writes the agent's
 * `/** @internal *\/` public state directly.
 */
import { spawnLowPriority } from '../process-priority';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { AgentTask, AgentExecutionResult } from '../base-agent';
import type { WorkerOutputMessage, WorkerInputMessage } from '../../../workers/output-parser-types';
import { createLogger } from '../../../config/logger';
import { registerProcess } from '../agent-process-tracker';
import { startResourceSampling } from '../process-resource-sampler';
import { createSelfVerificationReporter } from '../../workflow/self-verification-activity/activity-reporter';
import {
  createCloseHandler,
  createErrorHandler,
  type ProcessHandlerContext,
} from './claude-process-handlers';
import { getClaudePath, buildSpawnCommand } from './cli-utils';
import { buildStructuredPrompt } from './prompt-builder';
import { startIdleMonitor } from './idle-monitor';
import type { ClaudeCodeAgent } from './agent-core';
import { formatPromptPreview } from '../../../utils/agent/prompt-preview';

import { buildSpawnEnv, writePromptToStdin } from './claude-spawn-env';
import { buildClaudeArgs } from './claude-args';
export { buildClaudeArgs } from './claude-args';
// NOTE: Re-exported — claude-execution-runner.test.ts and agent-core tests' mock.module expect it here.
export { buildSpawnEnv } from './claude-spawn-env';

const logger = createLogger('claude-code-agent');

/**
 * Run the spawn-and-wait body for ClaudeCodeAgent.execute().
 *
 * @param agent - Host agent providing state, config, and emitters.
 * @param task - Task to execute.
 * @param workDir - Verified working directory.
 * @param startTime - Promise start timestamp.
 * @param timeout - Idle/total timeout in ms.
 * @param resolve - Promise resolver from execute().
 * @param buildResolveAfterParse - Bound `agent.buildResolveAfterParse`.
 */
export async function runClaudeExecution(
  agent: ClaudeCodeAgent,
  task: AgentTask,
  workDir: string,
  startTime: number,
  timeout: number,
  resolve: (result: AgentExecutionResult) => void,
  buildResolveAfterParse: (
    code: number | null,
    workDir: string,
    startTime: number,
    resolve: (result: AgentExecutionResult) => void,
    resourceStats?: { cpuTimeMs: number | null; peakRssKb: number | null },
  ) => () => void,
): Promise<void> {
  // In --resume or --continue mode, use the prompt (user response) as-is
  // Adding extra text would break the session resumption context
  const isResumeMode = !!(agent.config.resumeSessionId || agent.config.continueConversation);
  const prompt = isResumeMode
    ? task.description || task.title
    : buildStructuredPrompt(task, workDir, agent.logPrefix);

  if (task.analysisInfo) {
    logger.info(`${agent.logPrefix} Using structured prompt with AI task analysis`);
    logger.info(`${agent.logPrefix} Analysis complexity: ${task.analysisInfo.complexity}`);
    logger.info(`${agent.logPrefix} Subtasks count: ${task.analysisInfo.subtasks?.length || 0}`);
  } else {
    logger.info(`${agent.logPrefix} Using simple prompt (no AI task analysis)`);
  }

  // Save prompt to temp file to bypass Windows command-line character limit.
  // mkdtempSync rather than a fixed rapitas-prompts directory holding a
  // timestamped file: both names were predictable, so another account on a
  // shared machine could pre-create either path as a symlink and read the
  // prompt (it carries repository content) or redirect the write elsewhere.
  // mkdtempSync returns a fresh 0700 directory whose name cannot be known
  // before the call.
  const tempDir = mkdtempSync(join(tmpdir(), 'rapitas-prompts-'));
  const promptFile = join(tempDir, 'prompt.txt');
  writeFileSync(promptFile, prompt, 'utf-8');

  const { args, logExtras } = buildClaudeArgs(agent);
  for (const line of logExtras) logger.info(line);

  const claudePath = await getClaudePath();
  const [finalCommand, finalArgs] = buildSpawnCommand(claudePath, args);

  logger.info(`${agent.logPrefix} Platform: ${process.platform} / Claude path: ${claudePath}`);
  logger.info(`${agent.logPrefix} Work directory: ${workDir}`);
  logger.info(`${agent.logPrefix} Prompt length: ${prompt.length} chars / Timeout: ${timeout}ms`);
  logger.info(`${agent.logPrefix} Args: ${args.join(' ')}`);

  agent.emitOutputInternal(`${agent.logPrefix} Starting execution...\n`);
  agent.emitOutputInternal(`${agent.logPrefix} Model: ${agent.config.model ?? 'default'}\n`);
  agent.emitOutputInternal(`${agent.logPrefix} Working directory: ${workDir}\n`);
  agent.emitOutputInternal(`${agent.logPrefix} Timeout: ${timeout / 1000}s\n`);
  // One line only — untagged continuation lines render as agent narrative (formatPromptPreview).
  agent.emitOutputInternal(`${agent.logPrefix} Prompt: ${formatPromptPreview(prompt)}\n\n`);

  const cleanupPromptFile = () => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Prompt file may already be deleted
    }
  };

  try {
    logger.info(`${agent.logPrefix} Final command: ${finalCommand}`);

    agent.process = spawnLowPriority(finalCommand, finalArgs, {
      cwd: workDir,
      shell: true,
      windowsHide: true, // NOTE: Prevents TCP handle inheritance — stops CLI process from inheriting port 3001 socket
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildSpawnEnv(),
    });

    if (agent.process.stdout) agent.process.stdout.setEncoding('utf8');
    if (agent.process.stderr) agent.process.stderr.setEncoding('utf8');

    logger.info(`${agent.logPrefix} Process spawned with PID: ${agent.process.pid}`);
    agent.emitOutputInternal(`${agent.logPrefix} Process PID: ${agent.process.pid}\n`);

    if (agent.process.pid) {
      registerProcess({
        pid: agent.process.pid,
        role: 'cli-agent',
        taskId: task.id,
        startedAt: new Date().toISOString(),
        parentPid: process.pid,
      });
      startResourceSampling(agent.process.pid);
    }

    writePromptToStdin(agent, prompt).catch((err) => {
      logger.error({ err }, `${agent.logPrefix} Failed to write prompt to stdin`);
    });

    agent.lineBuffer = '';

    // NOTE: Task 1582 — sees self-verification jobs for this worktree written
    // by the server (any process), emits the waiting/result lines for display
    // only (not outputBuffer, which feeds artifact parsing and validators).
    const selfVerification = createSelfVerificationReporter({
      workDir,
      executionStartedAt: startTime,
      emit: (line) => agent.emitOutputInternal(line),
    });

    // Start idle and timeout monitors
    const monitor = startIdleMonitor(agent.logPrefix, timeout, startTime, {
      isSelfVerificationActive: selfVerification.isActive,
      onTick: selfVerification.tick,
      onFlushLineBuffer: (content) => {
        agent.outputBuffer += content;
        agent.emitOutputInternal(content);
        agent.lineBuffer = '';
      },
      onTimeout: (result) => {
        agent.setStatusInternal('failed');
        resolve(result);
      },
      getLineBuffer: () => agent.lineBuffer,
      getOutputBufferLength: () => agent.outputBuffer.length,
      getOutputBuffer: () => agent.outputBuffer,
      getErrorBuffer: () => agent.errorBuffer,
      getStatus: () => agent.getStatus(),
      getProcess: () => agent.process,
      setIdleTimeoutForceKilled: (v) => {
        agent.idleTimeoutForceKilled = v;
      },
      setWallClockTimeoutForceKilled: (v) => {
        agent.wallClockTimeoutForceKilled = v;
      },
    });

    // Spawn a Worker for output parsing
    agent.parserWorker = new Worker(
      new URL('../../../workers/output-parser-worker.ts', import.meta.url).href,
    );
    agent.parserWorker.postMessage({
      type: 'configure',
      config: {
        timeoutSeconds: agent.config.timeout ? Math.floor(agent.config.timeout / 1000) : undefined,
        logPrefix: agent.logPrefix,
      },
    } satisfies WorkerInputMessage);

    agent.parserWorker.onmessage = (event: MessageEvent<WorkerOutputMessage>) => {
      // 周期通知より先に完了イベントが届いても、待機状態を表示へ先に渡す。
      selfVerification.tick();
      agent.handleWorkerMessageInternal(event.data);
    };

    agent.parserWorker.onerror = (error: ErrorEvent) => {
      logger.error({ errorMessage: error.message }, `${agent.logPrefix} Worker uncaught error`);
    };

    agent.process.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      monitor.recordOutput();
      monitor.markReceivedOutput();

      const elapsedMs = Date.now() - startTime;
      logger.info(
        `${agent.logPrefix} First stdout received after ${elapsedMs}ms (${chunk.length} chars)`,
      );

      // Delegate chunk to Worker (parsing runs on the Worker thread)
      try {
        agent.parserWorker?.postMessage({
          type: 'parse-chunk',
          data: chunk,
        } satisfies WorkerInputMessage);
      } catch (workerErr) {
        // Ignore if Worker is already terminated (InvalidStateError)
        logger.warn(
          { errorDetail: workerErr instanceof Error ? workerErr.message : workerErr },
          `${agent.logPrefix} Worker postMessage failed`,
        );
        agent.parserWorker = null;
      }
    });

    agent.process.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      agent.errorBuffer += output;
      monitor.recordOutput(); // Treat stderr as output to reset the timeout
      logger.info(
        `${agent.logPrefix} stderr (${output.length} chars): ${output.substring(0, 200)}`,
      );
      agent.emitOutputInternal(output, true);
    });

    const handlerCtx: ProcessHandlerContext = {
      agent,
      workDir,
      startTime,
      resolve,
      buildResolveAfterParse,
      monitor,
      cleanupPromptFile,
      reporter: selfVerification,
    };
    const onClose = createCloseHandler(handlerCtx);
    agent.process.on('close', (code: number | null) => {
      onClose(code).catch((err) => {
        logger.error({ err }, `${agent.logPrefix} close handler failed`);
      });
    });
    agent.process.on('error', createErrorHandler(handlerCtx));
  } catch (error) {
    // NOTE: This catch block handles errors before spawn, so monitor is not yet started
    cleanupPromptFile();
    agent.setStatusInternal('failed');
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ err: error }, `${agent.logPrefix} Spawn error`);
    resolve({
      success: false,
      output: '',
      errorMessage,
      executionTimeMs: Date.now() - startTime,
    });
  }
}
