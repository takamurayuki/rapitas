/**
 * CodexCliAgent — Process Runner
 *
 * Handles spawning the Codex CLI child process, managing idle/timeout intervals,
 * wiring stdout/stderr/close event handlers, and resolving the execution promise.
 * JSON event processing is delegated to json-event-handler.ts.
 * Not responsible for prompt building or artifact parsing.
 */

import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import type { AgentExecutionResult, AgentArtifact, GitCommitInfo } from '../base-agent';
import type { QuestionWaitingState } from '../question-detection';
import { tolegacyQuestionType } from '../question-detection';
import { createLogger } from '../../../config/logger';
import type { CodexCliAgentConfig } from './types';
import { resolveCliPath } from './types';
import { processJsonEvent } from './json-event-handler';

const logger = createLogger('codex-cli-agent/process-runner');

/** Milliseconds of idle stdout before flushing incomplete line buffer. */
const OUTPUT_IDLE_TIMEOUT = 30000;

/** Milliseconds before warning that no output has been received at all. */
const INITIAL_OUTPUT_TIMEOUT = 60000;

/** Interval for idle-check polling. */
const IDLE_CHECK_INTERVAL_MS = 5000;

/** Interval for timeout-check polling. */
const TIMEOUT_CHECK_INTERVAL_MS = 10000;

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
  process: ChildProcess | null;
  outputBuffer: string;
  errorBuffer: string;
  lineBuffer: string;
  detectedQuestion: QuestionWaitingState;
  activeTools: Map<string, { name: string; startTime: number; info: string }>;
  codexSessionId: string | null;
  actualModel: string | null;
  status: string;
};

/**
 * Build the final spawn command and args for the given platform.
 *
 * @param codexPath - Resolved path to the Codex CLI executable / Codex CLI実行ファイルのパス
 * @param args - Codex CLI argument list / Codex CLIの引数リスト
 * @param isWindows - Whether the current platform is Windows / Windows上で実行中かどうか
 * @returns Tuple of [command, args] ready for `spawn` / `spawn`に渡す[command, args]のタプル
 */
export function buildSpawnCommand(
  codexPath: string,
  args: string[],
  isWindows: boolean,
): [string, string[]] {
  if (!isWindows) return [codexPath, args];

  const argsString = args
    .map((arg) => {
      if (arg.includes(' ') || arg.includes('&') || arg.includes('|') || arg.includes('\n')) {
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    })
    .join(' ');

  const quotedPath = codexPath.includes(' ') ? `"${codexPath}"` : codexPath;
  // NOTE: chcp 65001 sets Windows console to UTF-8 before running Codex to avoid garbled output
  return [`chcp 65001 >NUL 2>&1 && ${quotedPath} ${argsString}`, []];
}

/**
 * Build the environment variables for the Codex CLI process.
 *
 * @param config - Agent configuration / エージェント設定
 * @param isWindows - Whether the current platform is Windows / Windows上で実行中かどうか
 * @returns Environment variables object / 環境変数オブジェクト
 */
export function buildProcessEnv(
  config: CodexCliAgentConfig,
  isWindows: boolean,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    CI: '1',
    TERM: 'dumb',
  };

  if (config.apiKey) env.OPENAI_API_KEY = config.apiKey;

  if (isWindows) {
    env.LANG = 'en_US.UTF-8';
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUTF8 = '1';
    env.CHCP = '65001';
  }

  return env;
}

/**
 * Spawn the Codex CLI process and wire up all event handlers.
 * Resolves with an AgentExecutionResult when the process exits.
 *
 * @param config - Agent configuration / エージェント設定
 * @param workDir - Working directory for execution / 実行用の作業ディレクトリ
 * @param prompt - Prompt string to pass as argument / 引数として渡すプロンプト文字列
 * @param state - Shared mutable runner state / 共有される可変ランナー状態
 * @param callbacks - Callbacks into the owning agent / 所有エージェントへのコールバック
 * @param startTime - Timestamp when execution started / 実行開始のタイムスタンプ
 * @param parseArtifacts - Function to extract artifacts from output / 出力からアーティファクトを抽出する関数
 * @param parseCommits - Function to extract commits from output / 出力からコミットを抽出する関数
 * @returns Promise resolving to AgentExecutionResult / AgentExecutionResultに解決するPromise
 */
export function spawnCodexProcess(
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

  return new Promise((resolve) => {
    const args: string[] = ['exec'];

    const resumeId = config.resumeSessionId;
    if (resumeId) {
      args.push('resume', resumeId);
      logger.info(`${logPrefix} Resuming session: ${resumeId}`);
    } else {
      args.push(prompt);
    }

    args.push('--json', '--cd', workDir);

    // NOTE: Default to full-auto since this is intended for automated execution
    if (config.yolo) {
      args.push('--yolo');
    } else {
      args.push('--full-auto');
    }

    if (config.model) {
      const model = normalizeCodexModel(
        config.model,
        !!config.apiKey || !!process.env.OPENAI_API_KEY,
      );
      args.push('-m', model);
    }

    if (config.sandboxMode) args.push('-s', config.sandboxMode);

    const isWindows = process.platform === 'win32';
    const codexPath = resolveCliPath(
      process.env.CODEX_CLI_PATH || (isWindows ? 'codex.cmd' : 'codex'),
    );

    logger.info(`${logPrefix} Platform: ${process.platform}, Codex: ${codexPath}`);
    logger.info(`${logPrefix} Timeout: ${timeout}ms, Prompt: ${prompt.length} chars`);

    callbacks.emitOutput(`${logPrefix} Starting execution...\n`);
    callbacks.emitOutput(`${logPrefix} Working directory: ${workDir}\n`);
    callbacks.emitOutput(`${logPrefix} Timeout: ${timeout / 1000}s\n`);
    callbacks.emitOutput(
      `${logPrefix} Prompt: ${prompt.substring(0, 200)}${prompt.length > 200 ? '...' : ''}\n\n`,
    );

    try {
      const [finalCommand, finalArgs] = buildSpawnCommand(codexPath, args, isWindows);
      const env = buildProcessEnv(config, isWindows);

      state.process = spawn(finalCommand, finalArgs, {
        cwd: workDir,
        shell: true,
        windowsHide: true, // NOTE: Prevents TCP handle inheritance — stops CLI process from inheriting port 3001 socket
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });

      if (state.process.stdout) state.process.stdout.setEncoding('utf8');
      if (state.process.stderr) state.process.stderr.setEncoding('utf8');

      logger.info(`${logPrefix} Process spawned with PID: ${state.process.pid}`);
      callbacks.emitOutput(`${logPrefix} Process PID: ${state.process.pid}\n`);

      // NOTE: codex exec receives the prompt via args, so stdin is not needed
      if (state.process.stdin) state.process.stdin.end();

      state.lineBuffer = '';

      let lastOutputTime = Date.now();
      let hasReceivedAnyOutput = false;

      const idleCheckInterval = setInterval(() => {
        const idleTime = Date.now() - lastOutputTime;
        const totalElapsed = Date.now() - startTime;

        if (!hasReceivedAnyOutput && totalElapsed > INITIAL_OUTPUT_TIMEOUT) {
          logger.warn(`${logPrefix} No output received after ${Math.floor(totalElapsed / 1000)}s`);
          callbacks.emitOutput(
            `\n[警告] ${Math.floor(totalElapsed / 1000)}秒経過しましたが、Codex CLIからの応答がありません。処理を継続しています...\n`,
          );
          hasReceivedAnyOutput = true;
        }

        if (idleTime > OUTPUT_IDLE_TIMEOUT && state.lineBuffer.trim()) {
          state.outputBuffer += state.lineBuffer + '\n';
          callbacks.emitOutput(state.lineBuffer + '\n');
          state.lineBuffer = '';
        }
      }, IDLE_CHECK_INTERVAL_MS);

      const cleanupIdleCheck = () => clearInterval(idleCheckInterval);

      const timeoutCheckInterval = setInterval(() => {
        if (state.process && !state.process.killed) {
          if (Date.now() - lastOutputTime >= timeout) {
            clearInterval(timeoutCheckInterval);
            cleanupIdleCheck();
            callbacks.emitOutput(
              `\n${logPrefix} Execution timed out (no output for ${timeout / 1000}s)\n`,
              true,
            );
            state.process.kill('SIGTERM');
            state.status = 'failed';
            callbacks.onStatusChange('failed');
            resolve({
              success: false,
              output: state.outputBuffer,
              errorMessage: `Execution timed out (no output for ${timeout / 1000}s)`,
              executionTimeMs: Date.now() - startTime,
            });
          }
        }
      }, TIMEOUT_CHECK_INTERVAL_MS);

      const cleanupTimeoutCheck = () => clearInterval(timeoutCheckInterval);

      state.process.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        state.lineBuffer += chunk;
        lastOutputTime = Date.now();

        if (!hasReceivedAnyOutput) {
          hasReceivedAnyOutput = true;
          logger.info(`${logPrefix} First stdout after ${Date.now() - startTime}ms`);
        }

        const lines = state.lineBuffer.split('\n');
        state.lineBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            logger.info(`${logPrefix} Event: ${json.type}`);
            processJsonEvent(json, state, callbacks, config, logPrefix);
          } catch {
            // NOTE: Filter non-JSON output (e.g., chcp command output on Windows)
            const trimmed = line.trim();
            if (
              !trimmed ||
              /^Active code page:/i.test(trimmed) ||
              /^現在のコード ページ:/i.test(trimmed) ||
              /^chcp\s/i.test(trimmed)
            ) {
              logger.info(`${logPrefix} Filtered non-JSON: ${trimmed.substring(0, 100)}`);
              continue;
            }
            logger.info(`${logPrefix} Raw output: ${line.substring(0, 200)}`);
            state.outputBuffer += line + '\n';
            callbacks.emitOutput(line + '\n');
          }
        }
      });

      state.process.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        state.errorBuffer += output;
        lastOutputTime = Date.now();
        const modelMatch = output.match(/(?:^|\n)model:\s*([^\r\n]+)/i);
        if (modelMatch?.[1]) state.actualModel = modelMatch[1].trim();
        callbacks.emitOutput(output, true);
      });

      state.process.on('close', (code: number | null) => {
        cleanupTimeoutCheck();
        cleanupIdleCheck();
        const executionTimeMs = Date.now() - startTime;

        if (state.lineBuffer.trim()) {
          state.outputBuffer += state.lineBuffer + '\n';
          callbacks.emitOutput(state.lineBuffer + '\n');
        }

        logger.info(`${logPrefix} Closed with code: ${code}, time: ${executionTimeMs}ms`);

        if (state.status === 'cancelled') {
          resolve({
            success: false,
            output: state.outputBuffer,
            errorMessage: 'Execution cancelled',
            executionTimeMs,
          });
          return;
        }
        if (state.status === 'failed') return;

        const artifacts = parseArtifacts(state.outputBuffer);
        const commits = parseCommits(state.outputBuffer);
        const { hasQuestion, question, questionKey, questionDetails } = state.detectedQuestion;
        const questionType = tolegacyQuestionType(state.detectedQuestion.questionType);

        if (hasQuestion) {
          state.status = 'waiting_for_input';
          callbacks.onStatusChange('waiting_for_input');
          callbacks.emitOutput(`\n${logPrefix} 回答を待っています...\n`);
          resolve({
            success: true,
            output: state.outputBuffer,
            artifacts,
            commits,
            executionTimeMs,
            waitingForInput: true,
            question,
            questionType,
            questionDetails,
            questionKey,
            claudeSessionId: state.codexSessionId || undefined,
            modelName: state.actualModel || config.model,
          });
          return;
        }

        const newStatus = code === 0 ? 'completed' : 'failed';
        state.status = newStatus;
        callbacks.onStatusChange(newStatus);

        let errorMessage: string | undefined;
        if (code !== 0) {
          const parts = [`プロセスがコード ${code} で終了しました`];
          if (state.errorBuffer.trim())
            parts.push(`\n\n【標準エラー出力】\n${state.errorBuffer.trim()}`);
          if (state.outputBuffer.trim()) parts.push(`\n${state.outputBuffer.trim().slice(-1000)}`);
          errorMessage = parts.join('');
        }

        resolve({
          success: code === 0,
          output: state.outputBuffer,
          artifacts,
          commits,
          executionTimeMs,
          waitingForInput: false,
          claudeSessionId: state.codexSessionId || undefined,
          modelName: state.actualModel || config.model,
          errorMessage,
        });
      });

      state.process.on('error', (error: Error) => {
        cleanupTimeoutCheck();
        cleanupIdleCheck();
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

export function normalizeCodexModel(model: string, hasApiKey: boolean): string {
  const trimmed = model.trim();
  if (!trimmed) return trimmed;

  // Legacy GPT-4-era API models are not reliable with Codex CLI ChatGPT
  // account mode. Prefer the current Codex-capable default family so the CLI
  // does not silently ignore the request and then report a different model.
  if (!hasApiKey && /^(gpt-4|gpt-3\.5)/i.test(trimmed)) {
    return 'gpt-5.5';
  }
  return trimmed;
}
