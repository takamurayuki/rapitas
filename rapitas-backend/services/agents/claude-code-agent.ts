/**
 * Claude Code CLI エージェント
 * Claude Code CLIを子プロセスとして起動し、タスクを実行する
 */

import { spawn, ChildProcess } from "child_process";
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

export type ClaudeCodeAgentConfig = {
  workingDirectory?: string;
  model?: string;
  dangerouslySkipPermissions?: boolean;
  timeout?: number; // milliseconds
  maxTokens?: number;
  continueConversation?: boolean; // 前回の会話を継続するか
  resumeSessionId?: string; // --resumeで使用するセッションID
};

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
  /** ファイル変更ツールの名前一覧 */
  private static readonly FILE_MODIFYING_TOOLS = new Set([
    "Write",
    "Edit",
    "NotebookEdit",
  ]);

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
      // AIタスク分析結果がある場合は構造化プロンプトを使用
      const prompt = this.buildStructuredPrompt(task);

      // ログ出力（AIタスク分析の使用状況を確認）
      if (task.analysisInfo) {
        console.log(
          `${this.logPrefix} Using structured prompt with AI task analysis`,
        );
        console.log(
          `${this.logPrefix} Analysis complexity: ${task.analysisInfo.complexity}`,
        );
        console.log(
          `${this.logPrefix} Subtasks count: ${task.analysisInfo.subtasks?.length || 0}`,
        );
      } else {
        console.log(`${this.logPrefix} Using simple prompt (no AI task analysis)`);
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
        console.log(
          `${this.logPrefix} Resuming specific session with --resume ${this.config.resumeSessionId}`,
        );
        console.log(
          `${this.logPrefix} Resume mode: prompt will be sent as user response`,
        );
      } else if (this.config.continueConversation) {
        // セッションIDがない場合は --continue で最新の会話を継続
        args.push("--continue");
        console.log(
          `${this.logPrefix} Continuing most recent conversation with --continue`,
        );
        console.log(
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

      // Windowsでは.cmdファイルを使用
      const isWindows = process.platform === "win32";
      const claudePath =
        process.env.CLAUDE_CODE_PATH || (isWindows ? "claude.cmd" : "claude");

      console.log(`${this.logPrefix} Platform: ${process.platform}`);
      console.log(`${this.logPrefix} Claude path: ${claudePath}`);
      console.log(`${this.logPrefix} Work directory: ${workDir}`);
      console.log(`${this.logPrefix} Prompt file: ${promptFile}`);

      console.log(`${this.logPrefix} ========================================`);
      console.log(`${this.logPrefix} Working directory: ${workDir}`);
      console.log(`${this.logPrefix} Prompt length: ${prompt.length} chars`);
      console.log(`${this.logPrefix} Timeout: ${timeout}ms`);
      console.log(`${this.logPrefix} Args: ${args.join(" ")}`);
      console.log(`${this.logPrefix} ========================================`);

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
        } catch {}
      };

      try {
        console.log(`${this.logPrefix} Spawn command: ${claudePath}`);
        console.log(`${this.logPrefix} Args: ${args.join(" ")}`);

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
          finalCommand = `chcp 65001 >nul && ${claudePath} ${argsString}`;
          finalArgs = []; // 引数はコマンド文字列に含まれているので空
        } else {
          finalCommand = claudePath;
          finalArgs = args;
        }

        console.log(`${this.logPrefix} Final command: ${finalCommand}`);

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

        console.log(
          `${this.logPrefix} Process spawned with PID: ${this.process.pid}`,
        );
        this.emitOutput(`${this.logPrefix} Process PID: ${this.process.pid}\n`);
        console.log(
          `${this.logPrefix} Prompt file: ${promptFile} (${prompt.length} chars)`,
        );

        // stdinへの書き込みを非同期で行う（バッファリング問題を回避）
        // プロンプトをチャンクに分けて書き込み、ドレインイベントを待つ
        // UTF-8 Bufferを使用してエンコーディング問題を回避
        const writePromptToStdin = async () => {
          if (!this.process?.stdin) {
            console.log(`${this.logPrefix} stdin is not available`);
            return;
          }

          const stdin = this.process.stdin;
          const CHUNK_SIZE = 16384; // 16KB chunks

          // stdinのエラーハンドラを設定
          stdin.on("error", (err) => {
            console.error(`${this.logPrefix} stdin error:`, err);
          });

          // プロンプトをUTF-8 Bufferに変換（エンコーディング問題を回避）
          const promptBuffer = Buffer.from(prompt, "utf8");
          console.log(
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
          console.log(
            `${this.logPrefix} Prompt written to stdin (${promptBuffer.length} bytes) in chunks`,
          );
        };

        // 非同期でstdinに書き込み開始（エラーをキャッチ）
        writePromptToStdin().catch((err) => {
          console.error(`${this.logPrefix} Failed to write prompt to stdin:`, err);
        });

        // stream-json形式のパース用バッファをリセット
        this.lineBuffer = "";

        // 出力アイドルタイムアウト: 一定時間stdoutからデータが来ない場合、バッファを強制処理
        let lastOutputTime = Date.now();
        let hasReceivedAnyOutput = false;
        const OUTPUT_IDLE_TIMEOUT = 30000; // 30秒
        const INITIAL_OUTPUT_TIMEOUT = 60000; // 初期出力タイムアウト: 60秒

        const idleCheckInterval = setInterval(() => {
          const idleTime = Date.now() - lastOutputTime;
          const totalElapsed = Date.now() - startTime;

          // 初期出力タイムアウト: 60秒経過しても何も出力がない場合は警告
          if (!hasReceivedAnyOutput && totalElapsed > INITIAL_OUTPUT_TIMEOUT) {
            console.warn(
              `${this.logPrefix} WARNING: No output received after ${Math.floor(totalElapsed / 1000)}s - Claude Code may not be responding`,
            );
            this.emitOutput(
              `\n[警告] ${Math.floor(totalElapsed / 1000)}秒経過しましたが、Claude Codeからの応答がありません。処理を継続しています...\n`,
            );
            // フラグを設定して、この警告が1回だけ出力されるようにする
            hasReceivedAnyOutput = true;
          }

          if (idleTime > OUTPUT_IDLE_TIMEOUT && this.lineBuffer.trim()) {
            console.log(
              `${this.logPrefix} Output idle for ${idleTime}ms, flushing lineBuffer (${this.lineBuffer.length} chars)`,
            );
            // バッファの残りを強制的に出力
            this.outputBuffer += this.lineBuffer + "\n";
            this.emitOutput(this.lineBuffer + "\n");
            this.lineBuffer = "";
          }
          // 定期的にステータスログを出力（デバッグ用）
          if (this.status === "running" && idleTime > 10000) {
            console.log(
              `${this.logPrefix} Still running... Output idle: ${Math.floor(idleTime / 1000)}s, Buffer: ${this.lineBuffer.length} chars, Total output: ${this.outputBuffer.length} chars, HasOutput: ${hasReceivedAnyOutput}`,
            );
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
              console.log(
                `${this.logPrefix} TIMEOUT: No output for ${timeout / 1000}s`,
              );
              console.log(
                `${this.logPrefix} Last output was ${Math.floor(timeSinceLastOutput / 1000)}s ago`,
              );
              console.log(
                `${this.logPrefix} Output so far: ${this.outputBuffer.substring(0, 500)}`,
              );
              console.log(
                `${this.logPrefix} Error so far: ${this.errorBuffer.substring(0, 500)}`,
              );
              console.log(
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

        this.process.stdout?.on("data", (data: Buffer) => {
          const chunk = data.toString();
          this.lineBuffer += chunk;
          lastOutputTime = Date.now(); // 最終出力時刻を更新

          // 最初の出力が来た時にログを出力
          if (!hasReceivedAnyOutput) {
            hasReceivedAnyOutput = true;
            const elapsedMs = Date.now() - startTime;
            console.log(
              `${this.logPrefix} First stdout received after ${elapsedMs}ms (${chunk.length} chars)`,
            );
          }

          // 改行で分割して行ごとに処理
          const lines = this.lineBuffer.split("\n");
          this.lineBuffer = lines.pop() || ""; // 最後の不完全な行は保持

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const json = JSON.parse(line);
              const timestamp = new Date().toISOString();
              console.log(
                `${this.logPrefix} [${timestamp}] Event type: ${json.type}`,
              );

              // イベントタイプに応じて出力を生成
              let displayOutput = "";
              switch (json.type) {
                case "assistant":
                  // アシスタントのメッセージ
                  if (json.message?.content) {
                    for (const block of json.message.content) {
                      if (block.type === "text") {
                        displayOutput += block.text;
                      } else if (block.type === "tool_use") {
                        // AskUserQuestionツールの検出（キーベース判定システム使用）
                        if (block.name === "AskUserQuestion") {
                          console.log(
                            `${this.logPrefix} AskUserQuestion tool detected!`,
                          );
                          console.log(
                            `${this.logPrefix} Tool input:`,
                            JSON.stringify(block.input),
                          );

                          // 新しいキーベース判定システムで質問を検出
                          const detectionResult = detectQuestionFromToolCall(
                            block.name,
                            block.input,
                            this.config.timeout
                              ? Math.floor(this.config.timeout / 1000)
                              : undefined,
                          );

                          // 質問待機状態を更新
                          this.detectedQuestion =
                            updateWaitingStateFromDetection(detectionResult);

                          console.log(
                            `${this.logPrefix} Question key generated:`,
                            this.detectedQuestion.questionKey,
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
                          });

                          displayOutput += `\n[質問] ${detectionResult.questionText}\n`;

                          // AskUserQuestionツールが検出されたら、プロセスを停止
                          // stdin が閉じられているため、応答を待ち続けるとエラーが連続発生する
                          // プロセスを停止して、ユーザーの回答後に --continue で再開する
                          console.log(
                            `${this.logPrefix} Stopping process to wait for user response`,
                          );
                          if (this.process && !this.process.killed) {
                            // SIGTERMで丁寧に終了（出力バッファのフラッシュを待つ）
                            this.process.kill("SIGTERM");
                          }
                        } else {
                          // ツール呼び出しの詳細情報を表示
                          const toolInfo = this.formatToolInfo(
                            block.name,
                            block.input,
                          );
                          displayOutput += `\n[Tool: ${block.name}] ${toolInfo}\n`;
                          // ファイル変更ツールの使用を追跡
                          if (
                            ClaudeCodeAgent.FILE_MODIFYING_TOOLS.has(block.name)
                          ) {
                            this.hasFileModifyingToolCalls = true;
                            console.log(
                              `${this.logPrefix} File-modifying tool detected: ${block.name}`,
                            );
                          }
                          // アクティブツールとして追跡
                          if (block.id) {
                            this.activeTools.set(block.id, {
                              name: block.name,
                              startTime: Date.now(),
                              info: toolInfo,
                            });
                          }
                        }
                      }
                    }
                  }
                  break;
                case "user":
                  // ユーザーメッセージ（ツール結果など）
                  if (json.message?.content) {
                    for (const block of json.message.content) {
                      if (block.type === "tool_result") {
                        // アクティブツールから情報を取得
                        const toolId = block.tool_use_id;
                        const activeTool = toolId
                          ? this.activeTools.get(toolId)
                          : undefined;

                        if (activeTool) {
                          const duration = (
                            (Date.now() - activeTool.startTime) /
                            1000
                          ).toFixed(1);
                          if (block.is_error) {
                            displayOutput += `[Tool Error: ${activeTool.name}] (${duration}s)\n`;
                          } else {
                            displayOutput += `[Tool Done: ${activeTool.name}] (${duration}s)\n`;
                          }
                          // アクティブツールから削除
                          this.activeTools.delete(toolId);
                        } else {
                          // 情報がない場合のフォールバック
                          const toolIdShort = toolId
                            ? `ID: ${toolId.substring(0, 8)}...`
                            : "";
                          if (block.is_error) {
                            displayOutput += `[Tool Error ${toolIdShort}]\n`;
                          } else {
                            displayOutput += `[Tool Done ${toolIdShort}]\n`;
                          }
                        }
                      }
                    }
                  }
                  break;
                case "result":
                  // 最終結果
                  if (json.result) {
                    const duration = json.duration_ms
                      ? ` (${(json.duration_ms / 1000).toFixed(1)}s)`
                      : "";
                    const cost = json.cost_usd
                      ? ` $${json.cost_usd.toFixed(4)}`
                      : "";
                    displayOutput += `\n[Result: ${json.subtype || "completed"}${duration}${cost}]\n`;
                    if (json.result && typeof json.result === "string") {
                      displayOutput += json.result + "\n";
                    }
                  }
                  break;
                case "system":
                  // initイベントからセッションIDをキャプチャ
                  if (json.subtype === "init" && json.session_id) {
                    this.claudeSessionId = json.session_id;
                    console.log(
                      `${this.logPrefix} Session ID captured: ${this.claudeSessionId}`,
                    );
                    // 再開モードの場合、セッションIDの一致を確認
                    if (
                      this.config.resumeSessionId &&
                      this.config.resumeSessionId !== json.session_id
                    ) {
                      console.warn(
                        `${this.logPrefix} WARNING: Requested session ${this.config.resumeSessionId} but got ${json.session_id}`,
                      );
                    }
                  }
                  // errorサブタイプの場合は詳細をログ
                  if (json.subtype === "error") {
                    console.error(
                      `${this.logPrefix} System error event:`,
                      JSON.stringify(json),
                    );
                    displayOutput += `[System Error: ${json.message || json.error || "unknown"}]\n`;
                  } else {
                    displayOutput += `[System: ${json.subtype || "info"}]\n`;
                  }
                  break;
                default:
                  console.log(
                    `${this.logPrefix} Unknown event type: ${json.type}`,
                    line.substring(0, 200),
                  );
              }

              if (displayOutput) {
                this.outputBuffer += displayOutput;
                this.emitOutput(displayOutput);
              }
            } catch (e) {
              // JSONパース失敗時は生の行をそのまま出力
              console.log(
                `${this.logPrefix} Raw output: ${line.substring(0, 200)}`,
              );
              this.outputBuffer += line + "\n";
              this.emitOutput(line + "\n");
            }
          }
        });

        this.process.stderr?.on("data", (data: Buffer) => {
          const output = data.toString();
          this.errorBuffer += output;
          lastOutputTime = Date.now(); // stderrも出力として扱い、タイムアウトをリセット
          console.log(
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
            console.log(
              `${this.logPrefix} Processing remaining lineBuffer: ${this.lineBuffer.substring(0, 200)}`,
            );
            this.outputBuffer += this.lineBuffer + "\n";
            this.emitOutput(this.lineBuffer + "\n");
          }

          console.log(
            `${this.logPrefix} Process closed with code: ${code}, time: ${executionTimeMs}ms`,
          );
          console.log(
            `${this.logPrefix} Final output length: ${this.outputBuffer.length}`,
          );
          console.log(
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

          const artifacts = this.parseArtifacts(this.outputBuffer);
          const commits = this.parseCommits(this.outputBuffer);

          // 質問検出（キーベース判定システム使用）
          console.log(`${this.logPrefix} Running question detection...`);
          console.log(
            `${this.logPrefix} detectedQuestion from stream:`,
            this.detectedQuestion,
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

          console.log(
            `${this.logPrefix} Final question detection - hasQuestion: ${hasQuestion}, questionType: ${questionType}, questionKey: ${JSON.stringify(questionKey)}, exitCode: ${code}`,
          );

          // 質問が検出された場合は、終了コードに関係なく入力待ち状態
          // Claude Codeは質問を出力しても終了コードが0でない場合がある
          if (hasQuestion) {
            this.status = "waiting_for_input";
            console.log(
              `${this.logPrefix} Setting status to waiting_for_input (exitCode: ${code})`,
            );
            console.log(
              `${this.logPrefix} Question detected (${questionType}): ${question.substring(0, 200)}`,
            );
            console.log(`${this.logPrefix} Question key:`, questionKey);
            console.log(
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
            errorParts.push(`プロセスがコード ${code} で終了しました`);

            // 再開モードの情報を追加
            if (this.config.resumeSessionId) {
              errorParts.push(
                `\n\n【セッション再開モード】\nセッションID: ${this.config.resumeSessionId}`,
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

            // 実行時間が非常に短い場合は警告
            if (executionTimeMs < 5000) {
              errorParts.push(
                `\n\n【警告】実行時間が ${executionTimeMs}ms と非常に短いです。セッションの再開に失敗した可能性があります。`,
              );
            }

            errorMessage = errorParts.join("");
            console.log(
              `${this.logPrefix} Detailed error message constructed (${errorMessage.length} chars)`,
            );
          }

          // エラー終了の場合はそのまま失敗として返す
          if (code !== 0) {
            console.log(
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

          // 正常終了（code === 0）の場合、git diffで実際のコード変更を確認する
          // ファイル変更ツール（Write/Edit等）が呼ばれていても、計画モード（EnterPlanMode）や
          // サブエージェント（Task）経由の場合は実際にファイルが変更されていない可能性がある
          console.log(
            `${this.logPrefix} Process exited successfully, verifying actual code changes...`,
          );
          console.log(
            `${this.logPrefix} hasFileModifyingToolCalls: ${this.hasFileModifyingToolCalls}`,
          );

          this.checkGitDiff(workDir)
            .then((hasChanges) => {
              if (hasChanges) {
                console.log(
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
                console.log(
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
                console.log(
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
              console.warn(
                `${this.logPrefix} Git diff check failed:`,
                err,
              );
              if (this.hasFileModifyingToolCalls) {
                // ファイル変更ツールが使われていれば実装が行われた可能性が高い
                console.log(
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
                console.log(
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
        });

        this.process.on("error", (error: Error) => {
          cleanupTimeoutCheck(); // タイムアウトチェックを停止
          cleanupIdleCheck(); // アイドルチェックを停止
          cleanupPromptFile(); // 一時ファイルを削除
          this.status = "failed";
          console.error(`${this.logPrefix} Process error:`, error);
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
        console.error(`${this.logPrefix} Spawn error:`, error);
        resolve({
          success: false,
          output: "",
          errorMessage,
          executionTimeMs: Date.now() - startTime,
        });
      }
    });
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
            console.log(`${this.logPrefix} Process ${pid} killed via taskkill`);
          }
        } catch (e) {
          console.error(`${this.logPrefix} taskkill failed:`, e);
          // フォールバックとして通常のkillを試行
          try {
            this.process.kill();
          } catch {}
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
      const claudePath =
        process.env.CLAUDE_CODE_PATH || (isWindows ? "claude.cmd" : "claude");
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
      console.log(`${this.logPrefix} Git diff check: unstaged changes found`);
      return true;
    }

    // 2. staged changes
    const staged = await runGitCommand(["diff", "--cached", "--stat"]);
    if (staged.length > 0) {
      console.log(`${this.logPrefix} Git diff check: staged changes found`);
      return true;
    }

    // 3. エージェントがコミット済みの場合: git statusで確認
    const status = await runGitCommand(["status", "--porcelain"]);
    if (status.length > 0) {
      console.log(`${this.logPrefix} Git diff check: working tree changes found`);
      return true;
    }

    // 4. 直近のコミットが実行中に作られた可能性を確認（直近5分以内のコミット）
    const recentCommit = await runGitCommand([
      "log", "--oneline", "--since=5.minutes.ago", "-1",
    ]);
    if (recentCommit.length > 0) {
      console.log(`${this.logPrefix} Git diff check: recent commit found: ${recentCommit}`);
      return true;
    }

    console.log(`${this.logPrefix} Git diff check: no changes detected`);
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
      console.log(
        `${this.logPrefix} Using optimized prompt (${task.optimizedPrompt.length} chars)`,
      );
      return task.optimizedPrompt;
    }

    const analysis = task.analysisInfo;

    if (!analysis) {
      // 分析結果がない場合は従来通りの単純なプロンプト（計画モード禁止の指示を付加）
      const basePrompt = task.description || task.title;
      return `${basePrompt}\n\n重要: 計画モード（EnterPlanMode）は使用せず、直接コードの実装を行ってください。計画を立てるだけで終わらず、必ずファイルの作成・編集まで完了させてください。`;
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

  /**
   * 出力からファイル変更などの成果物を解析
   */
  private parseArtifacts(output: string): AgentArtifact[] {
    const artifacts: AgentArtifact[] = [];

    // ファイル作成/編集のパターンを検出
    const filePatterns = [
      /(?:Created|Modified|Wrote to|Writing to)[:\s]+([^\n]+)/gi,
      /File: ([^\n]+)/gi,
    ];

    for (const pattern of filePatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(output)) !== null) {
        const captured = match[1];
        if (!captured) continue;
        const filePath = captured.trim();
        if (filePath && !filePath.includes("...")) {
          artifacts.push({
            type: "file",
            name: filePath.split("/").pop() || filePath,
            content: "", // 実際のコンテンツは後で取得
            path: filePath,
          });
        }
      }
    }

    // diff出力を検出
    const diffPattern = /```diff\n([\s\S]*?)```/g;
    let diffMatch;
    while ((diffMatch = diffPattern.exec(output)) !== null) {
      artifacts.push({
        type: "diff",
        name: "changes.diff",
        content: diffMatch[1] || "",
      });
    }

    return artifacts;
  }

  /**
   * 出力からGitコミット情報を解析
   */
  private parseCommits(output: string): GitCommitInfo[] {
    const commits: GitCommitInfo[] = [];

    // コミットハッシュのパターンを検出
    const commitPattern = /(?:Committed|commit)\s+([a-f0-9]{7,40})/gi;
    let match;
    while ((match = commitPattern.exec(output)) !== null) {
      commits.push({
        hash: match[1] || "",
        message: "", // 詳細はgit logから取得する必要あり
        branch: "",
        filesChanged: 0,
        additions: 0,
        deletions: 0,
      });
    }

    return commits;
  }

  /**
   * ツール情報を人間が読みやすい形式にフォーマット
   */
  private formatToolInfo(
    toolName: string,
    input: Record<string, unknown> | undefined,
  ): string {
    if (!input) return "";

    try {
      switch (toolName) {
        case "Read":
          return input.file_path
            ? `-> ${String(input.file_path).split(/[/\\]/).pop()}`
            : "";
        case "Write":
          return input.file_path
            ? `-> ${String(input.file_path).split(/[/\\]/).pop()}`
            : "";
        case "Edit":
          return input.file_path
            ? `-> ${String(input.file_path).split(/[/\\]/).pop()}`
            : "";
        case "Glob":
          return input.pattern ? `pattern: ${input.pattern}` : "";
        case "Grep":
          return input.pattern ? `pattern: ${input.pattern}` : "";
        case "Bash":
          const cmd = String(input.command || "");
          return cmd.length > 50 ? `$ ${cmd.substring(0, 50)}...` : `$ ${cmd}`;
        case "Task":
          return input.description ? String(input.description) : "";
        case "WebFetch":
          return input.url ? `-> ${String(input.url).substring(0, 40)}...` : "";
        case "WebSearch":
          return input.query ? `"${input.query}"` : "";
        case "LSP":
          return input.operation ? String(input.operation) : "";
        default:
          // 一般的なツールの場合は最初のキーの値を表示
          const firstKey = Object.keys(input)[0];
          if (firstKey && input[firstKey]) {
            const val = String(input[firstKey]);
            return val.length > 40 ? `${val.substring(0, 40)}...` : val;
          }
          return "";
      }
    } catch {
      return "";
    }
  }
}
