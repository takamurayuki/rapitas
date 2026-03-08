/**
 * Claude Code CLI エージェント
 * Claude Code CLIを子プロセスとして起動し、タスクを実行する
 */

import { spawn, ChildProcess, execSync } from "child_process";
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { BaseAgent } from "./base-agent";
import type {
  AgentCapability,
  AgentTask,
  AgentExecutionResult,
  AgentArtifact,
  GitCommitInfo,
  TaskAnalysisInfo,
  QuestionType,
} from "./base-agent";
import {
  detectQuestionFromToolCall,
  createInitialWaitingState,
  updateWaitingStateFromDetection,
  tolegacyQuestionType,
  toExecutionResultFormat,
} from "./question-detection";
import type {
  QuestionDetails,
  QuestionKey,
  QuestionWaitingState,
} from "./question-detection";
import type {
  WorkerOutputMessage,
  WorkerInputMessage,
} from "../../workers/output-parser-types";
import { createLogger } from "../../config/logger";

const logger = createLogger("claude-code-agent");

export type ClaudeCodeAgentConfig = {
  workingDirectory?: string;
  model?: string;
  dangerouslySkipPermissions?: boolean;
  timeout?: number; // milliseconds
  maxTokens?: number;
  continueConversation?: boolean; // 前回の会話を継続するか
  resumeSessionId?: string; // --resumeで使用するセッションID
};

/**
 * Windows環境でCLIコマンドの絶対パスを解決する。
 * PATH解決に失敗した場合はフォールバックとして元のパスを返す。
 */
function resolveCliPath(cliName: string): string {
  if (process.platform !== "win32") return cliName;
  try {
    const resolved = execSync(`where ${cliName}`, {
      encoding: "utf8",
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
  private outputBuffer: string = "";
  private errorBuffer: string = "";
  private lineBuffer: string = ""; // stream-json形式のパース用
  /** 質問待機状態（新しいキーベース判定システム） */
  private detectedQuestion: QuestionWaitingState = createInitialWaitingState();
  private activeTools: Map<
    string,
    { name: string; startTime: number; info: string }
  > = new Map();
  /** Claude CodeのセッションID（--resumeで会話を継続するため） */
  private claudeSessionId: string | null = null;
  /** ファイル変更ツール（Write, Edit, NotebookEdit, Bash）が正常に使用されたかどうか */
  private hasFileModifyingToolCalls: boolean = false;
  /** アイドルハングによる強制終了フラグ */
  private idleTimeoutForceKilled: boolean = false;
  /** ファイル変更ツールの名前一覧 */
  private static readonly FILE_MODIFYING_TOOLS = new Set([
    "Write",
    "Edit",
    "NotebookEdit",
  ]);
  /** 出力パース用 Worker */
  private parserWorker: Worker | null = null;
  /** Workerからパースされたアーティファクト */
  private workerArtifacts: AgentArtifact[] = [];
  /** Workerからパースされたコミット */
  private workerCommits: GitCommitInfo[] = [];
  /** parse-complete完了時のコールバック */
  private onParseComplete: (() => void) | null = null;

  constructor(id: string, name: string, config: ClaudeCodeAgentConfig = {}) {
    super(id, name, "claude-code");
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
    options?: Record<string, unknown>,
  ): Promise<AgentExecutionResult> {
    this.status = "running";
    this.outputBuffer = "";
    this.errorBuffer = "";
    this.lineBuffer = "";
    this.detectedQuestion = createInitialWaitingState();
    this.activeTools.clear();
    this.claudeSessionId = null;
    this.hasFileModifyingToolCalls = false;
    this.idleTimeoutForceKilled = false;
    this.workerArtifacts = [];
    this.workerCommits = [];
    this.onParseComplete = null;
    const startTime = Date.now();

    // タイムアウトのデフォルト値を確実に設定
    const timeout = this.config.timeout ?? 900000; // 15分

    // Promise executorをasyncにしないため、事前に非同期処理を行う
    const fs = await import("fs/promises");
    const workDir =
      task.workingDirectory || this.config.workingDirectory || process.cwd();

    // 作業ディレクトリの存在確認を事前に行う
    try {
      const stats = await fs.stat(workDir);
      if (!stats.isDirectory()) {
        this.status = "failed";
        return {
          success: false,
          output: "",
          errorMessage: `Working directory is not a directory: ${workDir}`,
          executionTimeMs: Date.now() - startTime,
        };
      }
    } catch (error) {
      this.status = "failed";
      return {
        success: false,
        output: "",
        errorMessage: `Working directory does not exist: ${workDir}`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Claude CLIが利用可能か事前に確認
    const isClaudeAvailable = await this.isAvailable();
    if (!isClaudeAvailable) {
      this.status = "failed";
      return {
        success: false,
        output: "",
        errorMessage: `Claude Code CLI not found.`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    return new Promise((resolve) => {
      // --resume または --continue モードでは、プロンプト（ユーザー回答）をそのまま使用
      // 余計なテキストを付加すると、セッション再開の文脈が崩れる
      const isResumeMode = !!(this.config.resumeSessionId || this.config.continueConversation);
      const prompt = isResumeMode
        ? (task.description || task.title)
        : this.buildStructuredPrompt(task);

      // ログ出力（AIタスク分析の使用状況を確認）
      if (task.analysisInfo) {
        logger.info(
          `${this.logPrefix} Using structured prompt with AI task analysis`,
        );
        logger.info(
          `${this.logPrefix} Analysis complexity: ${task.analysisInfo.complexity}`,
        );
        logger.info(
          `${this.logPrefix} Subtasks count: ${task.analysisInfo.subtasks?.length || 0}`,
        );
      } else {
        logger.info(`${this.logPrefix} Using simple prompt (no AI task analysis)`);
      }

      // プロンプトを一時ファイルに保存（Windowsのコマンドライン文字制限を回避）
      const tempDir = join(tmpdir(), "rapitas-prompts");
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }
      const promptFile = join(tempDir, `prompt-${Date.now()}.txt`);
      writeFileSync(promptFile, prompt, "utf-8");

      // Claude Code CLI コマンドを構築
      const args: string[] = [];

      args.push("--print");
      args.push("--verbose"); // より詳細な出力を取得（リアルタイム性向上）
      args.push("--output-format", "stream-json"); // JSONストリーミング形式で出力

      // 前回の会話を継続する場合
      // --resume <sessionId> で特定のセッションを再開
      // --continue は最新の会話を継続（セッションIDがない場合のフォールバック）
      if (this.config.resumeSessionId) {
        // セッションIDがある場合は --resume で特定セッションを再開
        args.push("--resume", this.config.resumeSessionId);
        logger.info(
          `${this.logPrefix} Resuming specific session with --resume ${this.config.resumeSessionId}`,
        );
        logger.info(
          `${this.logPrefix} Resume mode: prompt will be sent as user response`,
        );
      } else if (this.config.continueConversation) {
        // セッションIDがない場合は --continue で最新の会話を継続
        args.push("--continue");
        logger.info(
          `${this.logPrefix} Continuing most recent conversation with --continue`,
        );
        logger.info(
          `${this.logPrefix} Resume mode: prompt will be sent as user response`,
        );
      }

      if (this.config.dangerouslySkipPermissions) {
        args.push("--dangerously-skip-permissions");
      }

      if (this.config.model) {
        args.push("--model", this.config.model);
      }

      if (this.config.maxTokens) {
        args.push("--max-tokens", String(this.config.maxTokens));
      }

      // Windowsでは.cmdファイルを使用（絶対パスに解決してPATH解決の問題を回避）
      const isWindows = process.platform === "win32";
      const baseClaudePath =
        process.env.CLAUDE_CODE_PATH || (isWindows ? "claude.cmd" : "claude");
      const claudePath = resolveCliPath(baseClaudePath);

      logger.info(`${this.logPrefix} Platform: ${process.platform}`);
      logger.info(`${this.logPrefix} Claude path: ${claudePath}`);
      logger.info(`${this.logPrefix} Work directory: ${workDir}`);
      logger.info(`${this.logPrefix} Prompt file: ${promptFile}`);

      logger.info(`${this.logPrefix} ========================================`);
      logger.info(`${this.logPrefix} Working directory: ${workDir}`);
      logger.info(`${this.logPrefix} Prompt length: ${prompt.length} chars`);
      logger.info(`${this.logPrefix} Timeout: ${timeout}ms`);
      logger.info(`${this.logPrefix} Args: ${args.join(" ")}`);
      logger.info(`${this.logPrefix} ========================================`);

      this.emitOutput(`${this.logPrefix} Starting execution...\n`);
      this.emitOutput(`${this.logPrefix} Working directory: ${workDir}\n`);
      this.emitOutput(`${this.logPrefix} Timeout: ${timeout / 1000}s\n`);
      this.emitOutput(
        `${this.logPrefix} Prompt: ${prompt.substring(0, 200)}${prompt.length > 200 ? "..." : ""}\n\n`,
      );

      // 一時ファイルのパスを保存（後でクリーンアップするため）
      const cleanupPromptFile = () => {
        try {
          unlinkSync(promptFile);
        } catch (_) {
          // Prompt file may already be deleted
        }
      };

      try {
        logger.info(`${this.logPrefix} Spawn command: ${claudePath}`);
        logger.info(`${this.logPrefix} Args: ${args.join(" ")}`);

        // shell: true を使用してClaude Codeを起動
        // Windows用のエンコーディング設定を追加
        let finalCommand: string;
        let finalArgs: string[];

        if (isWindows) {
          // Windowsの場合、chcp 65001でUTF-8コードページを設定してからclaude.cmdを実行
          // 引数も含めて1つのコマンド文字列として構築（シェルが正しく解釈するため）
          const argsString = args
            .map((arg) => {
              // スペースや特殊文字を含む引数はクォートで囲む
              if (arg.includes(" ") || arg.includes("&") || arg.includes("|")) {
                return `"${arg}"`;
              }
              return arg;
            })
            .join(" ");
          // 絶対パスにスペースが含まれる可能性があるためクォートで囲む
          const quotedPath = claudePath.includes(" ") ? `"${claudePath}"` : claudePath;
          finalCommand = `chcp 65001 >NUL 2>&1 && ${quotedPath} ${argsString}`;
          finalArgs = []; // 引数はコマンド文字列に含まれているので空
        } else {
          finalCommand = claudePath;
          finalArgs = args;
        }

        logger.info(`${this.logPrefix} Final command: ${finalCommand}`);

        this.process = spawn(finalCommand, finalArgs, {
          cwd: workDir,
          shell: true,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            FORCE_COLOR: "0",
            NO_COLOR: "1",
            CI: "1",
            TERM: "dumb",
            PYTHONUNBUFFERED: "1",
            NODE_OPTIONS: "--no-warnings",
            // Windows用UTF-8エンコーディング設定
            ...(isWindows && {
              LANG: "en_US.UTF-8",
              PYTHONIOENCODING: "utf-8",
              PYTHONUTF8: "1",
              // Windows 10以降でUTF-8モードを有効化
              CHCP: "65001",
            }),
          },
        });

        // プロセスのstdoutをimmediateモードに設定（より即座に出力を取得）
        if (this.process.stdout) {
          this.process.stdout.setEncoding("utf8");
        }
        if (this.process.stderr) {
          this.process.stderr.setEncoding("utf8");
        }

        logger.info(
          `${this.logPrefix} Process spawned with PID: ${this.process.pid}`,
        );
        this.emitOutput(`${this.logPrefix} Process PID: ${this.process.pid}\n`);
        logger.info(
          `${this.logPrefix} Prompt file: ${promptFile} (${prompt.length} chars)`,
        );

        // stdinへの書き込みを非同期で行う（バッファリング問題を回避）
        // プロンプトをチャンクに分けて書き込み、ドレインイベントを待つ
        // UTF-8 Bufferを使用してエンコーディング問題を回避
        const writePromptToStdin = async () => {
          if (!this.process?.stdin) {
            logger.info(`${this.logPrefix} stdin is not available`);
            return;
          }

          const stdin = this.process.stdin;
          const CHUNK_SIZE = 16384; // 16KB chunks

          // stdinのエラーハンドラを設定
          stdin.on("error", (err) => {
            logger.error({ err }, `${this.logPrefix} stdin error`);
          });

          // プロンプトをUTF-8 Bufferに変換（エンコーディング問題を回避）
          const promptBuffer = Buffer.from(prompt, "utf8");
          logger.info(
            `${this.logPrefix} Prompt buffer size: ${promptBuffer.length} bytes`,
          );

          // チャンク単位で書き込み（Buffer使用）
          for (let i = 0; i < promptBuffer.length; i += CHUNK_SIZE) {
            const chunk = promptBuffer.subarray(
              i,
              Math.min(i + CHUNK_SIZE, promptBuffer.length),
            );
            const canContinue = stdin.write(chunk);

            if (!canContinue) {
              // バッファがフルの場合、ドレインを待つ
              await new Promise<void>((resolve) => {
                stdin.once("drain", resolve);
              });
            }
          }

          // 書き込み完了後にstdinを閉じる
          stdin.end();
          logger.info(
            `${this.logPrefix} Prompt written to stdin (${promptBuffer.length} bytes) in chunks`,
          );
        };

        // 非同期でstdinに書き込み開始（エラーをキャッチ）
        writePromptToStdin().catch((err) => {
          logger.error({ err }, `${this.logPrefix} Failed to write prompt to stdin`);
        });

        // stream-json形式のパース用バッファをリセット
        this.lineBuffer = "";

        // 出力アイドルタイムアウト: 一定時間stdoutからデータが来ない場合、バッファを強制処理
        let lastOutputTime = Date.now();
        let hasReceivedAnyOutput = false;
        this.idleTimeoutForceKilled = false; // アイドルハングによる強制終了フラグ（インスタンス変数に変更）
        const OUTPUT_IDLE_TIMEOUT = 30000; // 30秒
        const INITIAL_OUTPUT_TIMEOUT = 60000; // 初期出力タイムアウト: 60秒
        const MAX_OUTPUT_IDLE_TIMEOUT = 300000; // 5分: 出力後に5分間アイドルならプロセスハングとみなす

        const idleCheckInterval = setInterval(() => {
          const idleTime = Date.now() - lastOutputTime;
          const totalElapsed = Date.now() - startTime;

          // 初期出力タイムアウト: 60秒経過しても何も出力がない場合は警告
          if (!hasReceivedAnyOutput && totalElapsed > INITIAL_OUTPUT_TIMEOUT) {
            logger.warn(
              `${this.logPrefix} WARNING: No output received after ${Math.floor(totalElapsed / 1000)}s - Claude Code may not be responding`,
            );
            this.emitOutput(
              `\n[警告] ${Math.floor(totalElapsed / 1000)}秒経過しましたが、Claude Codeからの応答がありません。処理を継続しています...\n`,
            );
            // フラグを設定して、この警告が1回だけ出力されるようにする
            hasReceivedAnyOutput = true;
          }

          if (idleTime > OUTPUT_IDLE_TIMEOUT && this.lineBuffer.trim()) {
            logger.info(
              `${this.logPrefix} Output idle for ${idleTime}ms, flushing lineBuffer (${this.lineBuffer.length} chars)`,
            );
            // バッファの残りを強制的に出力
            this.outputBuffer += this.lineBuffer + "\n";
            this.emitOutput(this.lineBuffer + "\n");
            this.lineBuffer = "";
          }
          // 定期的にステータスログを出力（デバッグ用）
          if (this.status === "running" && idleTime > 10000) {
            logger.info(
              `${this.logPrefix} Still running... Output idle: ${Math.floor(idleTime / 1000)}s, Buffer: ${this.lineBuffer.length} chars, Total output: ${this.outputBuffer.length} chars, HasOutput: ${hasReceivedAnyOutput}`,
            );
          }

          // アイドルハング検出: 出力があった後にMAX_OUTPUT_IDLE_TIMEOUT以上アイドルならプロセスハングとみなす
          if (
            hasReceivedAnyOutput &&
            idleTime > MAX_OUTPUT_IDLE_TIMEOUT &&
            !this.lineBuffer.trim() &&
            this.status === "running" &&
            this.process &&
            !this.process.killed
          ) {
            logger.warn(
              `${this.logPrefix} OUTPUT IDLE HANG DETECTED: No output for ${Math.floor(idleTime / 1000)}s after producing ${this.outputBuffer.length} chars. Force-killing hung process.`,
            );
            this.emitOutput(
              `\n${this.logPrefix} プロセスが${Math.floor(idleTime / 1000)}秒間応答がないため、ハングとみなして強制終了します。\n`,
            );
            this.idleTimeoutForceKilled = true;
            clearInterval(idleCheckInterval);

            // プロセスを強制終了
            const pid = this.process.pid;
            if (process.platform === "win32") {
              try {
                if (pid) {
                  execSync(`taskkill /PID ${pid} /T /F`, {
                    stdio: "ignore",
                    windowsHide: true,
                  });
                  logger.info(
                    `${this.logPrefix} Process ${pid} killed via taskkill (idle hang)`,
                  );
                }
              } catch (e) {
                logger.warn(
                  { err: e },
                  `${this.logPrefix} taskkill failed (idle hang), trying process.kill()`,
                );
                try {
                  this.process.kill();
                } catch (killErr) {
                  logger.warn({ err: killErr }, `${this.logPrefix} process.kill() also failed (idle hang)`);
                }
              }
            } else {
              this.process.kill("SIGTERM");
            }
          }
        }, 5000); // 5秒ごとにチェック

        // プロセス完了時にインターバルをクリア
        const cleanupIdleCheck = () => {
          clearInterval(idleCheckInterval);
        };

        // タイムアウト設定（出力がない場合のみタイムアウトを適用）
        // 一定間隔でチェックし、最後の出力からtimeout時間経過した場合にタイムアウト
        const timeoutCheckInterval = setInterval(() => {
          if (this.process && !this.process.killed) {
            const timeSinceLastOutput = Date.now() - lastOutputTime;

            // 最後の出力からtimeout時間経過した場合のみタイムアウト
            if (timeSinceLastOutput >= timeout) {
              logger.info(
                `${this.logPrefix} TIMEOUT: No output for ${timeout / 1000}s`,
              );
              logger.info(
                `${this.logPrefix} Last output was ${Math.floor(timeSinceLastOutput / 1000)}s ago`,
              );
              logger.info(
                `${this.logPrefix} Output so far: ${this.outputBuffer.substring(0, 500)}`,
              );
              logger.info(
                `${this.logPrefix} Error so far: ${this.errorBuffer.substring(0, 500)}`,
              );
              logger.info(
                `${this.logPrefix} LineBuffer: ${this.lineBuffer.substring(0, 500)}`,
              );
              clearInterval(timeoutCheckInterval); // タイムアウトチェックを停止
              cleanupIdleCheck(); // アイドルチェックを停止
              this.emitOutput(
                `\n${this.logPrefix} Execution timed out (no output for ${timeout / 1000}s)\n`,
                true,
              );
              this.process.kill("SIGTERM");
              this.status = "failed";
              resolve({
                success: false,
                output: this.outputBuffer,
                errorMessage: `Execution timed out (no output for ${timeout / 1000}s)`,
                executionTimeMs: Date.now() - startTime,
              });
            }
          }
        }, 10000); // 10秒ごとにチェック

        // タイムアウトチェックのクリーンアップ関数
        const cleanupTimeoutCheck = () => {
          clearInterval(timeoutCheckInterval);
        };

        // 出力パース用 Worker を生成
        this.parserWorker = new Worker(
          new URL("../../workers/output-parser-worker.ts", import.meta.url).href,
        );
        this.parserWorker.postMessage({
          type: "configure",
          config: {
            timeoutSeconds: this.config.timeout
              ? Math.floor(this.config.timeout / 1000)
              : undefined,
            logPrefix: this.logPrefix,
          },
        } satisfies WorkerInputMessage);

        // Worker からのメッセージハンドリング
        this.parserWorker.onmessage = (event: MessageEvent<WorkerOutputMessage>) => {
          const msg = event.data;
          switch (msg.type) {
            case "system-event":
              if (msg.sessionId) {
                this.claudeSessionId = msg.sessionId;
                logger.info(
                  `${this.logPrefix} Session ID captured: ${this.claudeSessionId}`,
                );
                // 再開モードの場合、セッションIDの一致を確認
                if (
                  this.config.resumeSessionId &&
                  this.config.resumeSessionId !== msg.sessionId
                ) {
                  logger.warn(
                    `${this.logPrefix} WARNING: Requested session ${this.config.resumeSessionId} but got ${msg.sessionId}`,
                  );
                  const mismatchWarning = `\n[警告] 指定されたセッション(${this.config.resumeSessionId.substring(0, 8)}...)の再開に失敗しました。新しいセッション(${msg.sessionId.substring(0, 8)}...)で続行します。前回のコンテキストが失われている可能性があります。\n`;
                  this.outputBuffer += mismatchWarning;
                  this.emitOutput(mismatchWarning);
                }
              }
              if (msg.subtype === "error") {
                logger.error(
                  `${this.logPrefix} System error event: ${msg.errorMessage}`,
                );
              }
              if (msg.displayOutput) {
                this.outputBuffer += msg.displayOutput;
                this.emitOutput(msg.displayOutput);
              }
              break;

            case "assistant-message":
              if (msg.displayOutput) {
                this.outputBuffer += msg.displayOutput;
                this.emitOutput(msg.displayOutput);
              }
              // アクティブツールの追跡をメインスレッドでも維持（close時の参照用）
              for (const tool of msg.toolUses) {
                this.activeTools.set(tool.id, {
                  name: tool.name,
                  startTime: Date.now(),
                  info: tool.info,
                });
              }
              break;

            case "user-message":
              if (msg.displayOutput) {
                this.outputBuffer += msg.displayOutput;
                this.emitOutput(msg.displayOutput);
              }
              // ツール完了を反映
              for (const result of msg.toolResults) {
                if (result.toolUseId) {
                  this.activeTools.delete(result.toolUseId);
                }
              }
              break;

            case "result-event":
              if (msg.displayOutput) {
                this.outputBuffer += msg.displayOutput;
                this.emitOutput(msg.displayOutput);
              }
              break;

            case "question-detected": {
              const detectionResult = msg.detectionResult;
              logger.info(
                `${this.logPrefix} AskUserQuestion tool detected via Worker!`,
              );

              // 質問待機状態を更新
              this.detectedQuestion =
                updateWaitingStateFromDetection(detectionResult);

              logger.info(
                { questionKey: this.detectedQuestion.questionKey },
                `${this.logPrefix} Question key generated`,
              );

              // 即座に質問検出を通知（DBを即時更新するため）
              this.status = "waiting_for_input";
              this.emitQuestionDetected({
                question: detectionResult.questionText,
                questionType: tolegacyQuestionType(
                  this.detectedQuestion.questionType,
                ),
                questionDetails:
                  this.detectedQuestion.questionDetails,
                questionKey: this.detectedQuestion.questionKey,
                claudeSessionId: this.claudeSessionId || undefined,
              });

              if (msg.displayOutput) {
                this.outputBuffer += msg.displayOutput;
                this.emitOutput(msg.displayOutput);
              }

              // プロセスを停止して、ユーザーの回答後に --resume で再開する
              logger.info(
                `${this.logPrefix} Stopping process to wait for user response`,
              );
              setTimeout(() => {
                if (this.process && !this.process.killed) {
                  logger.info(
                    `${this.logPrefix} Stopping process after stabilization delay (5s)`,
                  );
                  this.killProcessForQuestion();
                }
              }, 5000);
              break;
            }

            case "tool-tracking":
              if (msg.hasFileModifyingToolCalls) {
                this.hasFileModifyingToolCalls = true;
                logger.info(
                  `${this.logPrefix} File-modifying tool detected via Worker`,
                );
              }
              break;

            case "raw-output":
              if (msg.displayOutput) {
                this.outputBuffer += msg.displayOutput;
                this.emitOutput(msg.displayOutput);
              }
              break;

            case "artifacts-parsed":
              this.workerArtifacts = msg.data.artifacts;
              logger.info(
                `${this.logPrefix} Artifacts parsed by Worker: ${this.workerArtifacts.length} items`,
              );
              break;

            case "commits-parsed":
              this.workerCommits = msg.data.commits;
              logger.info(
                `${this.logPrefix} Commits parsed by Worker: ${this.workerCommits.length} items`,
              );
              break;

            case "parse-complete":
              logger.info(
                `${this.logPrefix} Worker parse-complete received`,
              );
              if (this.onParseComplete) {
                this.onParseComplete();
                this.onParseComplete = null;
              }
              // Workerを終了
              try {
                this.parserWorker?.postMessage({ type: "terminate" } satisfies WorkerInputMessage);
              } catch {
                // Worker already terminated
              }
              this.parserWorker = null;
              break;

            case "error":
              logger.error(
                { stack: msg.stack },
                `${this.logPrefix} Worker error: ${msg.message}`,
              );
              break;
          }
        };

        this.parserWorker.onerror = (error: ErrorEvent) => {
          logger.error(
            { errorMessage: error.message },
            `${this.logPrefix} Worker uncaught error`,
          );
        };

        this.process.stdout?.on("data", (data: Buffer) => {
          const chunk = data.toString();
          lastOutputTime = Date.now(); // 最終出力時刻を更新

          // 最初の出力が来た時にログを出力
          if (!hasReceivedAnyOutput) {
            hasReceivedAnyOutput = true;
            const elapsedMs = Date.now() - startTime;
            logger.info(
              `${this.logPrefix} First stdout received after ${elapsedMs}ms (${chunk.length} chars)`,
            );
          }

          // Worker にチャンクを委譲（パース処理はWorkerスレッドで実行）
          try {
            this.parserWorker?.postMessage({
              type: "parse-chunk",
              data: chunk,
            } satisfies WorkerInputMessage);
          } catch (workerErr) {
            // Worker が終了済みの場合は無視（InvalidStateError: Worker has been terminated）
            logger.warn(
              { errorDetail: workerErr instanceof Error ? workerErr.message : workerErr },
              `${this.logPrefix} Worker postMessage failed`,
            );
            this.parserWorker = null;
          }
        });

        this.process.stderr?.on("data", (data: Buffer) => {
          const output = data.toString();
          this.errorBuffer += output;
          lastOutputTime = Date.now(); // stderrも出力として扱い、タイムアウトをリセット
          logger.info(
            `${this.logPrefix} stderr (${output.length} chars): ${output.substring(0, 200)}`,
          );
          this.emitOutput(output, true);
        });

        this.process.on("close", (code: number | null) => {
          cleanupTimeoutCheck(); // タイムアウトチェックを停止
          cleanupIdleCheck(); // アイドルチェックを停止
          cleanupPromptFile(); // 一時ファイルを削除
          const executionTimeMs = Date.now() - startTime;

          // 残りのlineBufferを処理
          if (this.lineBuffer.trim()) {
            logger.info(
              `${this.logPrefix} Processing remaining lineBuffer: ${this.lineBuffer.substring(0, 200)}`,
            );
            this.outputBuffer += this.lineBuffer + "\n";
            this.emitOutput(this.lineBuffer + "\n");
          }

          logger.info(
            `${this.logPrefix} Process closed with code: ${code}, time: ${executionTimeMs}ms`,
          );
          logger.info(
            `${this.logPrefix} Final output length: ${this.outputBuffer.length}`,
          );
          logger.info(
            `${this.logPrefix} Last 500 chars of output: ${this.outputBuffer.slice(-500)}`,
          );

          if (this.status === "cancelled") {
            resolve({
              success: false,
              output: this.outputBuffer,
              errorMessage: "Execution cancelled",
              executionTimeMs,
            });
            return;
          }

          // タイムアウトで既にresolveされている場合はスキップ
          if (this.status === "failed") {
            return;
          }

          // Workerにparse-completeを送信し、アーティファクト・コミットパースを実行
          // Worker結果を待ってからresolveする
          const resolveAfterParse = () => {
            const artifacts = this.workerArtifacts;
            const commits = this.workerCommits;

          // 質問検出（キーベース判定システム使用）
          logger.info(`${this.logPrefix} Running question detection...`);
          logger.info(
            { detectedQuestion: this.detectedQuestion },
            `${this.logPrefix} detectedQuestion from stream`,
          );

          // 新しいキーベース判定システムからの結果を使用
          const hasQuestion = this.detectedQuestion.hasQuestion;
          const question = this.detectedQuestion.question;
          const questionKey = this.detectedQuestion.questionKey;
          const questionDetails = this.detectedQuestion.questionDetails;

          // 後方互換性のためのquestionType変換
          const questionType = tolegacyQuestionType(
            this.detectedQuestion.questionType,
          );

          logger.info(
            `${this.logPrefix} Final question detection - hasQuestion: ${hasQuestion}, questionType: ${questionType}, questionKey: ${JSON.stringify(questionKey)}, exitCode: ${code}`,
          );

          // 質問が検出された場合は、終了コードに関係なく入力待ち状態
          // Claude Codeは質問を出力しても終了コードが0でない場合がある
          if (hasQuestion) {
            this.status = "waiting_for_input";
            logger.info(
              `${this.logPrefix} Setting status to waiting_for_input (exitCode: ${code})`,
            );
            logger.info(
              `${this.logPrefix} Question detected (${questionType}): ${question.substring(0, 200)}`,
            );
            logger.info({ questionKey }, `${this.logPrefix} Question key`);
            logger.info(
              `${this.logPrefix} Session ID for resume: ${this.claudeSessionId}`,
            );
            this.emitOutput(`\n${this.logPrefix} 回答を待っています...\n`);
            resolve({
              success: true, // 技術的には成功だが、完了ではない
              output: this.outputBuffer,
              artifacts,
              commits,
              executionTimeMs,
              waitingForInput: true,
              question,
              questionType,
              questionDetails,
              questionKey, // 新しい構造化キー情報
              claudeSessionId: this.claudeSessionId || undefined,
            });
            return;
          }

          // エラー時は詳細なエラーメッセージを構築
          let errorMessage: string | undefined;
          if (code !== 0) {
            const errorParts: string[] = [];
            errorParts.push(`Process exited with code ${code}`);

            // 再開モードの情報を追加（フォールバック判定でマッチするようにキーワードを含める）
            if (this.config.resumeSessionId) {
              errorParts.push(
                `\n\n【セッション再開モード】session expired or not found\nセッションID: ${this.config.resumeSessionId}`,
              );
              errorParts.push(
                `\n※ セッションが期限切れまたは無効な可能性があります`,
              );
            } else if (this.config.continueConversation) {
              errorParts.push(
                `\n\n【会話継続モード】\n--continue フラグを使用`,
              );
            }

            // stderrの内容があれば追加
            if (this.errorBuffer.trim()) {
              errorParts.push(
                `\n\n【標準エラー出力】\n${this.errorBuffer.trim()}`,
              );
            }

            // stdoutの最後の部分を追加（エラーの手がかりになる可能性）
            if (this.outputBuffer.trim()) {
              const lastOutput = this.outputBuffer.trim().slice(-1000);
              errorParts.push(`\n${lastOutput}`);
            }

            // lineBufferに残っている未処理のデータがあれば追加
            if (this.lineBuffer.trim()) {
              errorParts.push(
                `\n\n【未処理バッファ】\n${this.lineBuffer.trim().slice(-500)}`,
              );
            }

            // 実行時間が非常に短い場合は警告（session resumeの失敗を示唆）
            if (executionTimeMs < 10000) {
              errorParts.push(
                `\n\n【警告】実行時間が ${executionTimeMs}ms と非常に短いです。session expired or not found - セッションの再開に失敗した可能性があります。`,
              );
            }

            errorMessage = errorParts.join("");
            logger.info(
              `${this.logPrefix} Detailed error message constructed (${errorMessage.length} chars)`,
            );
          }

          // エラー終了の場合はそのまま失敗として返す
          // ただし、アイドルハングによる強制終了の場合はexit codeに関わらずgit diff判定へ進む
          if (code !== 0 && !this.idleTimeoutForceKilled) {
            logger.info(
              `${this.logPrefix} No question detected, setting status to failed (exitCode: ${code})`,
            );
            this.status = "failed";
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

          // 正常終了（code === 0）またはアイドルハングkillの場合、git diffで実際のコード変更を確認する
          // ファイル変更ツール（Write/Edit等）が呼ばれていても、計画モード（EnterPlanMode）や
          // サブエージェント（Task）経由の場合は実際にファイルが変更されていない可能性がある
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
                this.status = "completed";
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
                // ファイル変更ツールは使われたがgit diffに反映されていない
                // （エージェントがコミット&リセットした等の稀なケース）
                // ツール使用を信頼してcompletedとする
                logger.info(
                  `${this.logPrefix} No git changes but file-modifying tools were used, setting status to completed`,
                );
                this.status = "completed";
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
                // 計画のみで実装が行われていない
                logger.info(
                  `${this.logPrefix} No git changes and no file-modifying tools used - agent likely only planned without implementing`,
                );
                this.status = "failed";
                resolve({
                  success: false,
                  output: this.outputBuffer,
                  artifacts,
                  commits,
                  executionTimeMs,
                  waitingForInput: false,
                  claudeSessionId: this.claudeSessionId || undefined,
                  errorMessage:
                    "エージェントは計画を出力しましたが、実際のコード変更は行われませんでした。プロンプトを見直して再実行してください。",
                });
              }
            })
            .catch((err) => {
              // git diffチェックに失敗した場合、ファイル変更ツールの使用有無で判定する
              logger.warn(
                { err },
                `${this.logPrefix} Git diff check failed`,
              );
              if (this.hasFileModifyingToolCalls) {
                // ファイル変更ツールが使われていれば実装が行われた可能性が高い
                logger.info(
                  `${this.logPrefix} Git diff failed but file-modifying tools were used, setting status to completed`,
                );
                this.status = "completed";
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
                // ファイル変更ツールも使われていなければ失敗とする
                logger.info(
                  `${this.logPrefix} Git diff failed and no file-modifying tools used, setting status to failed`,
                );
                this.status = "failed";
                resolve({
                  success: false,
                  output: this.outputBuffer,
                  artifacts,
                  commits,
                  executionTimeMs,
                  waitingForInput: false,
                  claudeSessionId: this.claudeSessionId || undefined,
                  errorMessage:
                    "エージェントの実行結果を検証できませんでした。コード変更が確認できません。",
                });
              }
            });
          };

          // Workerが存在する場合はparse-completeを送信して結果を待つ
          // Workerが無い場合はフォールバックとして直接実行
          if (this.parserWorker) {
            this.workerArtifacts = [];
            this.workerCommits = [];
            this.onParseComplete = resolveAfterParse;

            try {
              this.parserWorker.postMessage({
                type: "parse-complete",
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

        this.process.on("error", (error: Error) => {
          cleanupTimeoutCheck(); // タイムアウトチェックを停止
          cleanupIdleCheck(); // アイドルチェックを停止
          cleanupPromptFile(); // 一時ファイルを削除
          this.status = "failed";
          logger.error({ err: error }, `${this.logPrefix} Process error`);
          this.emitOutput(`${this.logPrefix} Error: ${error.message}\n`, true);

          // 詳細なエラーメッセージを構築
          const errorParts: string[] = [];
          errorParts.push(`プロセス起動エラー: ${error.message}`);

          if (this.errorBuffer.trim()) {
            errorParts.push(
              `\n\n【標準エラー出力】\n${this.errorBuffer.trim()}`,
            );
          }

          if (this.outputBuffer.trim()) {
            errorParts.push(
              `\n\n【標準出力】\n${this.outputBuffer.trim().slice(-500)}`,
            );
          }

          resolve({
            success: false,
            output: this.outputBuffer,
            errorMessage: errorParts.join(""),
            executionTimeMs: Date.now() - startTime,
          });
        });
      } catch (error) {
        // catchブロックはspawn前のエラーをキャッチするため、idleCheckIntervalはまだ設定されていない
        cleanupPromptFile(); // 一時ファイルを削除
        this.status = "failed";
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error({ err: error }, `${this.logPrefix} Spawn error`);
        resolve({
          success: false,
          output: "",
          errorMessage,
          executionTimeMs: Date.now() - startTime,
        });
      }
    });
  }

  /**
   * 質問検出時にプロセスを丁寧に停止する
   * Windowsでは taskkill を使用し、Unix系ではSIGTERMを送信する
   * stop()と異なり、ステータスを cancelled にしない（waiting_for_input を維持）
   */
  private killProcessForQuestion(): void {
    if (!this.process || this.process.killed) return;

    const isWindows = process.platform === "win32";

    if (isWindows) {
      // Windowsでは taskkill を使用してプロセスツリーを終了
      try {
        const pid = this.process.pid;
        if (pid) {
          const { execSync } = require("child_process");
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
          logger.info(`${this.logPrefix} Process ${pid} killed via taskkill (question detected)`);
        }
      } catch (e) {
        logger.error({ err: e }, `${this.logPrefix} taskkill failed (question detected)`);
        try {
          this.process.kill();
        } catch (killErr) {
          logger.warn({ err: killErr }, `${this.logPrefix} process.kill() also failed (question detected)`);
        }
      }
    } else {
      this.process.kill("SIGTERM");
    }
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.status = "cancelled";
      this.emitOutput(`\n${this.logPrefix} Stopping execution...\n`);

      const isWindows = process.platform === "win32";

      if (isWindows) {
        // Windowsでは taskkill を使用してプロセスツリーを強制終了
        try {
          const pid = this.process.pid;
          if (pid) {
            const { execSync } = require("child_process");
            // /T でプロセスツリー全体を終了、/F で強制終了
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
            logger.info(`${this.logPrefix} Process ${pid} killed via taskkill`);
          }
        } catch (e) {
          logger.error({ err: e }, `${this.logPrefix} taskkill failed`);
          // フォールバックとして通常のkillを試行
          try {
            this.process.kill();
          } catch (killErr) {
            logger.warn({ err: killErr }, `${this.logPrefix} process.kill() also failed`);
          }
        }
      } else {
        // Unix系OSではSIGINTを送信して丁寧に終了を試みる
        this.process.kill("SIGINT");

        // 5秒後にまだ動いていればSIGTERMを送信
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            if (!this.process || this.process.killed) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);

          setTimeout(() => {
            if (this.process && !this.process.killed) {
              this.process.kill("SIGTERM");
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
    if (this.process && this.status === "running") {
      this.process.kill("SIGSTOP");
      this.status = "paused";
      this.emitOutput(`\n${this.logPrefix} Execution paused\n`);
      return true;
    }
    return false;
  }

  async resume(): Promise<boolean> {
    if (this.process && this.status === "paused") {
      this.process.kill("SIGCONT");
      this.status = "running";
      this.emitOutput(`\n${this.logPrefix} Execution resumed\n`);
      return true;
    }
    return false;
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const isWindows = process.platform === "win32";
      const baseClaudePath =
        process.env.CLAUDE_CODE_PATH || (isWindows ? "claude.cmd" : "claude");
      const claudePath = resolveCliPath(baseClaudePath);
      const proc = spawn(claudePath, ["--version"], { shell: true });

      // 10秒タイムアウト
      const timeout = setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 10000);

      proc.on("close", (code) => {
        clearTimeout(timeout);
        resolve(code === 0);
      });
      proc.on("error", () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }

  /**
   * 作業ディレクトリでgit diffを確認し、変更があるかどうかを返す
   * unstaged、staged、直近のコミットすべてを確認する
   */
  private async checkGitDiff(workDir: string): Promise<boolean> {
    const runGitCommand = (args: string[]): Promise<string> => {
      return new Promise((resolve, reject) => {
        const proc = spawn("git", args, {
          cwd: workDir,
          shell: true,
        });

        let output = "";
        const timeout = setTimeout(() => {
          proc.kill();
          reject(new Error(`git ${args.join(" ")} timed out`));
        }, 5000);

        proc.stdout?.on("data", (data: Buffer) => {
          output += data.toString();
        });

        proc.on("close", () => {
          clearTimeout(timeout);
          resolve(output.trim());
        });

        proc.on("error", (err) => {
          clearTimeout(timeout);
          reject(new Error(`git ${args.join(" ")} failed: ${err.message}`));
        });
      });
    };

    // 0. gitリポジトリかどうかを確認
    const revParse = await runGitCommand(["rev-parse", "--is-inside-work-tree"]);
    if (revParse !== "true") {
      throw new Error(`workDir is not a git repository: ${workDir}`);
    }

    // 1. unstaged changes
    const unstaged = await runGitCommand(["diff", "--stat", "HEAD"]);
    if (unstaged.length > 0) {
      logger.info(`${this.logPrefix} Git diff check: unstaged changes found`);
      return true;
    }

    // 2. staged changes
    const staged = await runGitCommand(["diff", "--cached", "--stat"]);
    if (staged.length > 0) {
      logger.info(`${this.logPrefix} Git diff check: staged changes found`);
      return true;
    }

    // 3. エージェントがコミット済みの場合: git statusで確認
    const status = await runGitCommand(["status", "--porcelain"]);
    if (status.length > 0) {
      logger.info(`${this.logPrefix} Git diff check: working tree changes found`);
      return true;
    }

    // 4. 直近のコミットが実行中に作られた可能性を確認（直近5分以内のコミット）
    const recentCommit = await runGitCommand([
      "log", "--oneline", "--since=5.minutes.ago", "-1",
    ]);
    if (recentCommit.length > 0) {
      logger.info(`${this.logPrefix} Git diff check: recent commit found: ${recentCommit}`);
      return true;
    }

    logger.info(`${this.logPrefix} Git diff check: no changes detected`);
    return false;
  }

  async validateConfig(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Claude CLIが利用可能か確認
    const available = await this.isAvailable();
    if (!available) {
      errors.push("Claude Code CLI is not installed or not available in PATH");
    }

    // 作業ディレクトリの検証
    if (this.config.workingDirectory) {
      try {
        const fs = await import("fs/promises");
        const stats = await fs.stat(this.config.workingDirectory);
        if (!stats.isDirectory()) {
          errors.push(
            `Working directory is not a directory: ${this.config.workingDirectory}`,
          );
        }
      } catch {
        errors.push(
          `Working directory does not exist: ${this.config.workingDirectory}`,
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * AIタスク分析結果から構造化プロンプトを生成
   * AIエージェントが理解しやすい形式でタスク情報を整形
   */
  private buildStructuredPrompt(task: AgentTask): string {
    // 最適化されたプロンプトが存在する場合はそれを優先使用
    // （PromptOptimizationPanelで生成された構造化プロンプト）
    if (task.optimizedPrompt) {
      logger.info(
        `${this.logPrefix} Using optimized prompt (${task.optimizedPrompt.length} chars)`,
      );
      return task.optimizedPrompt;
    }

    const analysis = task.analysisInfo;

    if (!analysis) {
      // 分析結果がない場合は従来通りの単純なプロンプト（ワークフロー指示を付加）
      const basePrompt = task.description || task.title;
      const workflowInstructions = [
        `\n\n## ワークフロー手順`,
        `以下の手順でタスクを実行してください：`,
        `1. 調査 → research.md保存`,
        `2. 不明点があれば question.md保存 + AskUserQuestion`,
        `3. plan.md作成・保存 → **承認待ちのため実装停止**`,
        `4. 承認後に実装`,
        `5. verify.md保存`,
        ``,
        `**ファイル保存API**: \`curl -X PUT http://localhost:3001/workflow/tasks/${task.id}/files/{research|question|plan|verify} -H 'Content-Type: application/json' -d '{"content":"..."}\`\``,
        ``,
        `**重要事項**:`,
        `- 計画モード（EnterPlanMode）は使用せず、直接コードの実装を行ってください。計画を立てるだけで終わらず、必ずファイルの作成・編集まで完了させてください。`,
        `- **プロジェクトルートには絶対にファイルを作成しないでください。一時ファイルも例外ではありません。**`,
        `- すべてのワークフロー関連ファイル（research/question/plan/verify）は上記のAPI経由で保存してください。`,
        `- WriteツールやBashツール(mkdir/echo)を使ったプロジェクトルートでのファイル作成は禁止です。`,
        `- **implementation_*.md、temp_*.md、*_content.json等の一時ファイルも作成しないでください。**`,
      ].join('\n');
      return basePrompt + workflowInstructions;
    }

    // 優先度のマッピング
    const priorityLabels: Record<string, string> = {
      low: "低",
      medium: "中",
      high: "高",
      urgent: "緊急",
    };

    // 複雑度のマッピング
    const complexityLabels: Record<string, string> = {
      simple: "シンプル",
      medium: "中程度",
      complex: "複雑",
    };

    // 構造化されたプロンプトを構築
    const sections: string[] = [];

    // ヘッダー
    sections.push("# タスク実装指示");
    sections.push("");

    // タスク概要
    sections.push("## 概要");
    sections.push(`**タスク名:** ${task.title}`);
    sections.push(`**分析サマリー:** ${analysis.summary}`);
    sections.push(
      `**複雑度:** ${complexityLabels[analysis.complexity] || analysis.complexity}`,
    );
    sections.push(`**推定総時間:** ${analysis.estimatedTotalHours}時間`);
    sections.push("");

    // タスク詳細説明（元のdescriptionがある場合）
    if (task.description) {
      sections.push("## タスク詳細");
      sections.push(task.description);
      sections.push("");
    }

    // サブタスク一覧（実装手順）
    if (analysis.subtasks && analysis.subtasks.length > 0) {
      sections.push("## 実装手順");
      sections.push("以下の順序でタスクを実装してください：");
      sections.push("");

      // 依存関係を考慮してソート（orderでソート）
      const sortedSubtasks = [...analysis.subtasks].sort(
        (a, b) => a.order - b.order,
      );

      for (const subtask of sortedSubtasks) {
        const priorityLabel =
          priorityLabels[subtask.priority] || subtask.priority;
        sections.push(`### ${subtask.order}. ${subtask.title}`);
        sections.push(`- **説明:** ${subtask.description}`);
        sections.push(`- **推定時間:** ${subtask.estimatedHours}時間`);
        sections.push(`- **優先度:** ${priorityLabel}`);

        if (subtask.dependencies && subtask.dependencies.length > 0) {
          const depTitles = subtask.dependencies
            .map((depOrder) => {
              const dep = analysis.subtasks.find((s) => s.order === depOrder);
              return dep ? `${depOrder}. ${dep.title}` : `ステップ${depOrder}`;
            })
            .join(", ");
          sections.push(`- **依存:** ${depTitles} の完了後に実行`);
        }
        sections.push("");
      }
    }

    // 分析理由
    if (analysis.reasoning) {
      sections.push("## 実装方針の根拠");
      sections.push(analysis.reasoning);
      sections.push("");
    }

    // 実装のヒント
    if (analysis.tips && analysis.tips.length > 0) {
      sections.push("## 実装のヒント");
      for (const tip of analysis.tips) {
        sections.push(`- ${tip}`);
      }
      sections.push("");
    }

    // ワークフロー指示
    sections.push("## ワークフロー手順");
    sections.push("以下の手順でワークフローファイルを作成しながらタスクを実行してください：");
    sections.push("");
    sections.push("1. **調査**: コードベースを調査し、結果をresearch.mdとして保存");
    sections.push("2. **質問**: 不明点があればquestion.mdとして保存し、AskUserQuestionで質問。不明点がなければスキップ");
    sections.push("3. **計画**: 調査結果と回答を反映してplan.mdを作成・保存。**plan.md保存後は承認を待つため、ここで実装を停止してください**");
    sections.push("4. **実装**: ユーザーが計画を承認した後に実装を行う（この段階では質問しない）");
    sections.push("5. **検証**: 実装結果をverify.mdとして保存");
    sections.push("");
    sections.push("### ワークフローファイルの保存方法");
    sections.push("**重要**: ワークフローファイルは必ず以下のAPIを使って保存してください。直接ファイルシステムにmkdir/Write等で作成しないでください。");
    sections.push("");
    sections.push("**禁止事項**:");
    sections.push("- **プロジェクトルートには絶対にファイルを作成しないでください。一時ファイルも例外ではありません。**");
    sections.push("- WriteツールやBashツール(mkdir/echo)を使ったプロジェクトルートでのファイル作成は禁止です。");
    sections.push("- **implementation_*.md、temp_*.md、*_content.json等の一時ファイルも作成しないでください。**");
    sections.push("");
    sections.push("```bash");
    sections.push(`# research.md を保存`);
    sections.push(`curl -X PUT http://localhost:3001/workflow/tasks/${task.id}/files/research -H 'Content-Type: application/json' -d '{"content":"# 調査結果\\n..."}'`);
    sections.push("");
    sections.push(`# question.md を保存`);
    sections.push(`curl -X PUT http://localhost:3001/workflow/tasks/${task.id}/files/question -H 'Content-Type: application/json' -d '{"content":"# 不明点\\n..."}'`);
    sections.push("");
    sections.push(`# plan.md を保存`);
    sections.push(`curl -X PUT http://localhost:3001/workflow/tasks/${task.id}/files/plan -H 'Content-Type: application/json' -d '{"content":"# 実装計画\\n..."}'`);
    sections.push("");
    sections.push(`# verify.md を保存`);
    sections.push(`curl -X PUT http://localhost:3001/workflow/tasks/${task.id}/files/verify -H 'Content-Type: application/json' -d '{"content":"# 検証レポート\\n..."}'`);
    sections.push("```");
    sections.push("");

    // 実行指示
    sections.push("## 実行指示");
    sections.push(
      "上記の手順に従って、タスクを最初から最後まで実装してください。",
    );
    sections.push("各ステップの完了後、次のステップに進んでください。");
    sections.push("不明点がある場合は、質問してください。");
    sections.push("");
    sections.push("## 重要な注意事項");
    sections.push(
      "- **計画モード（EnterPlanMode）は使用しないでください。** 直接コードの実装を行ってください。",
    );
    sections.push(
      "- 計画を立てるだけで終わらず、必ずファイルの作成・編集まで完了させてください。",
    );
    sections.push(
      "- **プロジェクトルートには絶対にファイルを作成しないでください。**",
    );
    sections.push(
      "- 一時ファイルも含め、すべてのワークフロー関連ファイルは上記のAPI経由で保存してください。",
    );
    sections.push(
      "- WriteツールやBashツール(mkdir/echo)を使ったファイル作成は禁止です。",
    );
    sections.push(
      "- Write、Edit等のツールを使って実際にコードを変更してください。",
    );

    return sections.join("\n");
  }

  /**
   * 出力から質問/入力待ちを検出
   * AskUserQuestionツール呼び出しを優先的に検出し、なければパターンマッチングにフォールバック
   */
  /**
   * AskUserQuestionツールの入力から質問情報を抽出
   * stream-json形式のAskUserQuestionツール呼び出しから質問テキストと詳細を取得
   */
  private extractQuestionInfo(input: Record<string, unknown> | undefined): {
    questionText: string;
    questionDetails?: QuestionDetails;
  } {
    if (!input) {
      return { questionText: "" };
    }

    let questionText = "";
    const questionDetails: QuestionDetails = {};

    // questionsフィールドがある場合（配列形式）
    if (input.questions && Array.isArray(input.questions)) {
      const questions = input.questions as Array<{
        question?: string;
        header?: string;
        options?: Array<{ label: string; description?: string }>;
        multiSelect?: boolean;
      }>;

      // 質問テキストを抽出
      questionText = questions
        .map((q) => q.question || q.header || "")
        .filter((q) => q)
        .join("\n");

      // ヘッダーを抽出
      const headers = questions
        .map((q) => q.header)
        .filter((h): h is string => !!h);
      if (headers.length > 0) {
        questionDetails.headers = headers;
      }

      // 最初の質問から選択肢とmultiSelectを取得
      const firstQuestion = questions[0];
      if (firstQuestion) {
        if (firstQuestion.options && Array.isArray(firstQuestion.options)) {
          questionDetails.options = firstQuestion.options.map((opt) => ({
            label: opt.label || "",
            description: opt.description,
          }));
        }
        if (typeof firstQuestion.multiSelect === "boolean") {
          questionDetails.multiSelect = firstQuestion.multiSelect;
        }
      }
    }
    // 単一のquestionフィールドがある場合
    else if (input.question && typeof input.question === "string") {
      questionText = input.question;
    }

    // questionDetailsが空でなければ返す
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
