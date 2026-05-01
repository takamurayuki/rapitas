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
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { AgentTask, AgentExecutionResult } from '../base-agent';
import type { WorkerOutputMessage, WorkerInputMessage } from '../../../workers/output-parser-types';
import { createLogger } from '../../../config/logger';
import { registerProcess, unregisterProcess } from '../agent-process-tracker';
import { getClaudePath, buildSpawnCommand } from './cli-utils';
import { buildStructuredPrompt } from './prompt-builder';
import { startIdleMonitor } from './idle-monitor';
import type { ClaudeCodeAgent } from './agent-core';

const logger = createLogger('claude-code-agent');

/**
 * Build the Claude Code CLI argument list from agent config. Pure function.
 */
function buildClaudeArgs(agent: ClaudeCodeAgent): { args: string[]; logExtras: string[] } {
  const cfg = agent.config;
  const args: string[] = ['--print', '--verbose', '--output-format', 'stream-json'];
  const logExtras: string[] = [];

  if (cfg.resumeSessionId) {
    args.push('--resume', cfg.resumeSessionId);
    logExtras.push(
      `${agent.logPrefix} Resuming specific session with --resume ${cfg.resumeSessionId}`,
    );
  } else if (cfg.continueConversation) {
    args.push('--continue');
    logExtras.push(`${agent.logPrefix} Continuing most recent conversation with --continue`);
  }

  if (cfg.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions');
    // NOTE: Also set permission-mode to ensure all file edits (including .claude/) are allowed
    args.push('--permission-mode', 'bypassPermissions');
  }
  if (cfg.model) args.push('--model', cfg.model);
  if (cfg.maxTokens) args.push('--max-tokens', String(cfg.maxTokens));

  // NOTE: Disable worktree tools to prevent the spawned CLI from creating nested worktrees
  // that conflict with rapitas-managed worktrees and could corrupt .git/ directory structure.
  // Investigation mode (research / planner / reviewer): block ALL mutating
  // tools so the agent can't bypass the parent-only workflow contract by
  // writing files directly, running shell commands (curl / git / pnpm),
  // or invoking the workflow API itself. Read-only tools (Read / Glob /
  // Grep / WebFetch / WebSearch) remain available so the agent can still
  // investigate the codebase.
  const disallowed = ['EnterWorktree', 'ExitWorktree'];
  if (cfg.investigationMode) {
    disallowed.push(
      'Bash',
      'PowerShell',
      'Edit',
      'Write',
      'MultiEdit',
      'NotebookEdit',
      'Task', // disallow Agent/Task tool to prevent recursion / tool re-acquisition
    );
    logExtras.push(
      `${agent.logPrefix} Investigation mode: blocking write/shell tools (${disallowed.slice(2).join(',')})`,
    );
  }
  args.push('--disallowedTools', disallowed.join(','));

  return { args, logExtras };
}

/** Build the env passed to the Claude Code CLI subprocess. */
function buildSpawnEnv(): NodeJS.ProcessEnv {
  const isWindows = process.platform === 'win32';
  return {
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
  };
}

/** Stream the prompt to stdin in 16 KB chunks (avoids buffering issues). */
async function writePromptToStdin(agent: ClaudeCodeAgent, prompt: string): Promise<void> {
  if (!agent.process?.stdin) {
    logger.info(`${agent.logPrefix} stdin is not available`);
    return;
  }
  const stdin = agent.process.stdin;
  const CHUNK_SIZE = 16384; // 16KB chunks

  stdin.on('error', (err) => {
    logger.error({ err }, `${agent.logPrefix} stdin error`);
  });

  // Convert prompt to UTF-8 Buffer to prevent encoding issues
  const promptBuffer = Buffer.from(prompt, 'utf8');
  logger.info(`${agent.logPrefix} Prompt buffer size: ${promptBuffer.length} bytes`);

  for (let i = 0; i < promptBuffer.length; i += CHUNK_SIZE) {
    const chunk = promptBuffer.subarray(i, Math.min(i + CHUNK_SIZE, promptBuffer.length));
    const canContinue = stdin.write(chunk);
    if (!canContinue) {
      await new Promise<void>((r) => stdin.once('drain', r));
    }
  }

  stdin.end();
  logger.info(
    `${agent.logPrefix} Prompt written to stdin (${promptBuffer.length} bytes) in chunks`,
  );
}

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
export function runClaudeExecution(
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
  ) => () => void,
): void {
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

  // Save prompt to temp file to bypass Windows command-line character limit
  const tempDir = join(tmpdir(), 'rapitas-prompts');
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }
  const promptFile = join(tempDir, `prompt-${Date.now()}.txt`);
  writeFileSync(promptFile, prompt, 'utf-8');

  const { args, logExtras } = buildClaudeArgs(agent);
  for (const line of logExtras) logger.info(line);

  const claudePath = getClaudePath();
  const [finalCommand, finalArgs] = buildSpawnCommand(claudePath, args);

  logger.info(`${agent.logPrefix} Platform: ${process.platform}`);
  logger.info(`${agent.logPrefix} Claude path: ${claudePath}`);
  logger.info(`${agent.logPrefix} Work directory: ${workDir}`);
  logger.info(`${agent.logPrefix} Prompt length: ${prompt.length} chars / Timeout: ${timeout}ms`);
  logger.info(`${agent.logPrefix} Args: ${args.join(' ')}`);

  agent.emitOutputInternal(`${agent.logPrefix} Starting execution...\n`);
  agent.emitOutputInternal(`${agent.logPrefix} Working directory: ${workDir}\n`);
  agent.emitOutputInternal(`${agent.logPrefix} Timeout: ${timeout / 1000}s\n`);
  agent.emitOutputInternal(
    `${agent.logPrefix} Prompt: ${prompt.substring(0, 200)}${prompt.length > 200 ? '...' : ''}\n\n`,
  );

  const cleanupPromptFile = () => {
    try {
      unlinkSync(promptFile);
    } catch (_) {
      // Prompt file may already be deleted
    }
  };

  try {
    logger.info(`${agent.logPrefix} Final command: ${finalCommand}`);

    agent.process = spawn(finalCommand, finalArgs, {
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
    }

    writePromptToStdin(agent, prompt).catch((err) => {
      logger.error({ err }, `${agent.logPrefix} Failed to write prompt to stdin`);
    });

    agent.lineBuffer = '';

    // Start idle and timeout monitors
    const monitor = startIdleMonitor(agent.logPrefix, timeout, startTime, {
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

    agent.process.on('close', (code: number | null) => {
      monitor.cleanup();
      cleanupPromptFile();
      if (agent.process?.pid) unregisterProcess(agent.process.pid);
      const executionTimeMs = Date.now() - startTime;

      if (agent.lineBuffer.trim()) {
        logger.info(
          `${agent.logPrefix} Processing remaining lineBuffer: ${agent.lineBuffer.substring(0, 200)}`,
        );
        agent.outputBuffer += agent.lineBuffer + '\n';
        agent.emitOutputInternal(agent.lineBuffer + '\n');
      }

      logger.info(
        `${agent.logPrefix} Process closed with code: ${code}, time: ${executionTimeMs}ms`,
      );
      logger.info(`${agent.logPrefix} Final output length: ${agent.outputBuffer.length}`);
      logger.info(`${agent.logPrefix} Last 500 chars of output: ${agent.outputBuffer.slice(-500)}`);

      if (agent.getStatus() === 'cancelled') {
        resolve({
          success: false,
          output: agent.outputBuffer,
          errorMessage: 'Execution cancelled',
          executionTimeMs,
        });
        return;
      }

      // Skip if already resolved by timeout
      if (agent.getStatus() === 'failed') return;

      const resolveAfterParse = buildResolveAfterParse(code, workDir, startTime, resolve);

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
    });

    agent.process.on('error', (error: Error) => {
      monitor.cleanup();
      cleanupPromptFile();
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
    });
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
