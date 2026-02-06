/**
 * Gemini CLI エージェント
 * Google Gemini CLIを子プロセスとして起動し、タスクを実行する
 *
 * Gemini CLI: @google/gemini-cli (npm install -g @google/gemini-cli)
 * https://github.com/google-gemini/gemini-cli
 *
 * 主な機能:
 * - -p フラグで非インタラクティブモードでプロンプトを渡す
 * - --output-format stream-json でJSONストリーミング出力
 * - --checkpoint でセッション継続
 * - GoogleSearch, Shell, ReadFile, WriteFile などのビルトインツール
 */

import { spawn, ChildProcess } from "child_process";
import { BaseAgent } from "./base-agent";
import type {
  AgentCapability,
  AgentTask,
  AgentExecutionResult,
  AgentArtifact,
  GitCommitInfo,
  QuestionType,
} from "./base-agent";
import {
  detectQuestionFromToolCall,
  createInitialWaitingState,
  updateWaitingStateFromDetection,
  tolegacyQuestionType,
} from "./question-detection";
import type {
  QuestionDetails,
  QuestionKey,
  QuestionWaitingState,
} from "./question-detection";

export type GeminiCliAgentConfig = {
  workingDirectory?: string;
  model?: string; // gemini-2.5-pro, gemini-2.5-flash など
  timeout?: number; // milliseconds
  maxTokens?: number;
  projectId?: string; // Google Cloud Project ID
  location?: string; // Google Cloud region (e.g., us-central1)
  apiKey?: string; // Gemini API Key (環境変数から取得可能)
  sandboxMode?: boolean; // サンドボックスモードで実行
  checkpointId?: string; // チェックポイントIDで会話を再開
  allowedTools?: string[]; // 許可するツール
  disallowedTools?: string[]; // 禁止するツール
  yolo?: boolean; // 自動承認モード
};

/**
 * Gemini CLI stream-json イベント型
 */
type GeminiStreamEvent = {
  type: "assistant" | "user" | "result" | "system" | "tool_use" | "tool_result";
  subtype?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      id?: string;
      input?: Record<string, unknown>;
      is_error?: boolean;
      tool_use_id?: string;
    }>;
  };
  result?: string;
  duration_ms?: number;
  cost_usd?: number;
  session_id?: string;
  checkpoint_id?: string;
  error?: string;
};

export class GeminiCliAgent extends BaseAgent {
  private process: ChildProcess | null = null;
  private config: GeminiCliAgentConfig;
  private outputBuffer: string = "";
  private errorBuffer: string = "";
  private lineBuffer: string = "";
  /** 質問待機状態 */
  private detectedQuestion: QuestionWaitingState = createInitialWaitingState();
  private activeTools: Map<
    string,
    { name: string; startTime: number; info: string }
  > = new Map();
  /** Gemini CLIのセッションID */
  private geminiSessionId: string | null = null;
  /** チェックポイントID（セッション継続用） */
  private checkpointId: string | null = null;

  constructor(id: string, name: string, config: GeminiCliAgentConfig = {}) {
    super(id, name, "gemini");
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
    this.geminiSessionId = null;
    const startTime = Date.now();

    const timeout = this.config.timeout ?? 900000;

    const fs = await import("fs/promises");
    const workDir =
      task.workingDirectory || this.config.workingDirectory || process.cwd();

    // 作業ディレクトリの存在確認
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

    // Gemini CLIが利用可能か確認
    const isGeminiAvailable = await this.isAvailable();
    if (!isGeminiAvailable) {
      this.status = "failed";
      return {
        success: false,
        output: "",
        errorMessage: `Gemini CLI not found. Please install it with: npm install -g @google/gemini-cli`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // チェックポイントIDをリセット
    this.checkpointId = null;

    return new Promise((resolve) => {
      const prompt = this.buildStructuredPrompt(task);

      console.log(
        `${this.logPrefix} Using ${task.analysisInfo ? "structured" : "simple"} prompt`,
      );
      if (task.analysisInfo) {
        console.log(
          `${this.logPrefix} Analysis complexity: ${task.analysisInfo.complexity}`,
        );
        console.log(
          `${this.logPrefix} Subtasks count: ${task.analysisInfo.subtasks?.length || 0}`,
        );
      }

      // Gemini CLI コマンドを構築
      // 公式ドキュメント: https://geminicli.com/docs/
      const args: string[] = [];

      // 非インタラクティブモード: -p フラグでプロンプトを渡す
      args.push("-p", prompt);

      // JSON形式で出力（stream-json形式）
      args.push("--output-format", "stream-json");

      // サンドボックスモード
      if (this.config.sandboxMode) {
        args.push("--sandbox");
      }

      // 自動承認モード（yolo）
      if (this.config.yolo) {
        args.push("--yolo");
      }

      // モデル指定
      if (this.config.model) {
        args.push("-m", this.config.model);
      }

      // チェックポイントIDで会話を再開
      const resumeId = this.config.checkpointId || task.resumeSessionId;
      if (resumeId) {
        args.push("--checkpoint", resumeId);
        console.log(`${this.logPrefix} Resuming from checkpoint: ${resumeId}`);
      }

      // 許可するツール
      if (this.config.allowedTools && this.config.allowedTools.length > 0) {
        args.push("--allowlist", this.config.allowedTools.join(","));
      }

      // 禁止するツール
      if (this.config.disallowedTools && this.config.disallowedTools.length > 0) {
        args.push("--denylist", this.config.disallowedTools.join(","));
      }

      const isWindows = process.platform === "win32";
      const geminiPath =
        process.env.GEMINI_CLI_PATH || (isWindows ? "gemini.cmd" : "gemini");

      console.log(`${this.logPrefix} Platform: ${process.platform}`);
      console.log(`${this.logPrefix} Gemini path: ${geminiPath}`);
      console.log(`${this.logPrefix} Work directory: ${workDir}`);
      console.log(`${this.logPrefix} ========================================`);
      console.log(`${this.logPrefix} Timeout: ${timeout}ms`);
      console.log(`${this.logPrefix} Args count: ${args.length}`);
      console.log(`${this.logPrefix} Prompt length: ${prompt.length} chars`);
      console.log(`${this.logPrefix} ========================================`);

      this.emitOutput(`${this.logPrefix} Starting execution...\n`);
      this.emitOutput(`${this.logPrefix} Working directory: ${workDir}\n`);
      this.emitOutput(`${this.logPrefix} Timeout: ${timeout / 1000}s\n`);
      this.emitOutput(
        `${this.logPrefix} Prompt: ${prompt.substring(0, 200)}${prompt.length > 200 ? "..." : ""}\n\n`,
      );

      try {
        console.log(`${this.logPrefix} Spawn command: ${geminiPath}`);
        console.log(`${this.logPrefix} Args: ${args.join(" ")}`);

        let finalCommand: string;
        let finalArgs: string[];

        if (isWindows) {
          const argsString = args
            .map((arg) => {
              if (arg.includes(" ") || arg.includes("&") || arg.includes("|")) {
                return `"${arg}"`;
              }
              return arg;
            })
            .join(" ");
          finalCommand = `chcp 65001 >nul && ${geminiPath} ${argsString}`;
          finalArgs = [];
        } else {
          finalCommand = geminiPath;
          finalArgs = args;
        }

        console.log(`${this.logPrefix} Final command: ${finalCommand.substring(0, 100)}...`);

        // 環境変数の準備
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          FORCE_COLOR: "0",
          NO_COLOR: "1",
          CI: "1",
          TERM: "dumb",
        };

        // APIキーを環境変数に設定
        if (this.config.apiKey) {
          env.GEMINI_API_KEY = this.config.apiKey;
        }

        // Google Cloud設定
        if (this.config.projectId) {
          env.GOOGLE_CLOUD_PROJECT = this.config.projectId;
        }
        if (this.config.location) {
          env.GOOGLE_CLOUD_LOCATION = this.config.location;
        }

        // Windows用UTF-8設定
        if (isWindows) {
          env.LANG = "en_US.UTF-8";
          env.PYTHONIOENCODING = "utf-8";
          env.PYTHONUTF8 = "1";
          env.CHCP = "65001";
        }

        this.process = spawn(finalCommand, finalArgs, {
          cwd: workDir,
          shell: true,
          stdio: ["pipe", "pipe", "pipe"],
          env,
        });

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

        // -p フラグでプロンプトを渡しているので、stdinへの書き込みは不要
        // stdinを閉じる
        if (this.process.stdin) {
          this.process.stdin.end();
        }

        this.lineBuffer = "";

        let lastOutputTime = Date.now();
        let hasReceivedAnyOutput = false;
        const OUTPUT_IDLE_TIMEOUT = 30000;
        const INITIAL_OUTPUT_TIMEOUT = 60000;

        const idleCheckInterval = setInterval(() => {
          const idleTime = Date.now() - lastOutputTime;
          const totalElapsed = Date.now() - startTime;

          if (!hasReceivedAnyOutput && totalElapsed > INITIAL_OUTPUT_TIMEOUT) {
            console.warn(
              `${this.logPrefix} WARNING: No output received after ${Math.floor(totalElapsed / 1000)}s`,
            );
            this.emitOutput(
              `\n[警告] ${Math.floor(totalElapsed / 1000)}秒経過しましたが、Gemini CLIからの応答がありません。処理を継続しています...\n`,
            );
            hasReceivedAnyOutput = true;
          }

          if (idleTime > OUTPUT_IDLE_TIMEOUT && this.lineBuffer.trim()) {
            console.log(
              `${this.logPrefix} Output idle for ${idleTime}ms, flushing lineBuffer`,
            );
            this.outputBuffer += this.lineBuffer + "\n";
            this.emitOutput(this.lineBuffer + "\n");
            this.lineBuffer = "";
          }

          if (this.status === "running" && idleTime > 10000) {
            console.log(
              `${this.logPrefix} Still running... Output idle: ${Math.floor(idleTime / 1000)}s`,
            );
          }
        }, 5000);

        const cleanupIdleCheck = () => {
          clearInterval(idleCheckInterval);
        };

        const timeoutCheckInterval = setInterval(() => {
          if (this.process && !this.process.killed) {
            const timeSinceLastOutput = Date.now() - lastOutputTime;

            if (timeSinceLastOutput >= timeout) {
              console.log(
                `${this.logPrefix} TIMEOUT: No output for ${timeout / 1000}s`,
              );
              clearInterval(timeoutCheckInterval);
              cleanupIdleCheck();
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
        }, 10000);

        const cleanupTimeoutCheck = () => {
          clearInterval(timeoutCheckInterval);
        };

        this.process.stdout?.on("data", (data: Buffer) => {
          const chunk = data.toString();
          this.lineBuffer += chunk;
          lastOutputTime = Date.now();

          if (!hasReceivedAnyOutput) {
            hasReceivedAnyOutput = true;
            const elapsedMs = Date.now() - startTime;
            console.log(
              `${this.logPrefix} First stdout received after ${elapsedMs}ms`,
            );
          }

          const lines = this.lineBuffer.split("\n");
          this.lineBuffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;

            // stream-json形式の出力をパース
            try {
              const json = JSON.parse(line) as GeminiStreamEvent;
              const timestamp = new Date().toISOString();
              console.log(
                `${this.logPrefix} [${timestamp}] Event type: ${json.type}`,
              );

              let displayOutput = "";
              switch (json.type) {
                case "assistant":
                  // アシスタントのメッセージ
                  if (json.message?.content) {
                    for (const block of json.message.content) {
                      if (block.type === "text" && block.text) {
                        displayOutput += block.text;
                      } else if (block.type === "tool_use") {
                        // Gemini CLI の質問ツールを検出
                        if (block.name === "AskUserQuestion" || block.name === "ask_user" || block.name === "ask") {
                          console.log(
                            `${this.logPrefix} Question tool detected: ${block.name}`,
                          );

                          const detectionResult = detectQuestionFromToolCall(
                            "AskUserQuestion",
                            block.input,
                            this.config.timeout
                              ? Math.floor(this.config.timeout / 1000)
                              : undefined,
                          );

                          this.detectedQuestion =
                            updateWaitingStateFromDetection(detectionResult);

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

                          // 質問検出時はプロセスを停止
                          console.log(
                            `${this.logPrefix} Stopping process to wait for user response`,
                          );
                          if (this.process && !this.process.killed) {
                            this.process.kill("SIGTERM");
                          }
                        } else {
                          // 通常のツール呼び出し
                          const toolInfo = this.formatToolInfo(
                            block.name || "unknown",
                            block.input,
                          );
                          displayOutput += `\n[Tool: ${block.name}] ${toolInfo}\n`;
                          if (block.id) {
                            this.activeTools.set(block.id, {
                              name: block.name || "unknown",
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
                      if (block.type === "tool_result" && block.tool_use_id) {
                        const toolId = block.tool_use_id;
                        const activeTool = this.activeTools.get(toolId);

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
                          this.activeTools.delete(toolId);
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
                    if (typeof json.result === "string") {
                      displayOutput += json.result + "\n";
                    }
                  }
                  break;

                case "system":
                  // セッションIDとチェックポイントIDをキャプチャ
                  if (json.session_id) {
                    this.geminiSessionId = json.session_id;
                    console.log(
                      `${this.logPrefix} Session ID: ${this.geminiSessionId}`,
                    );
                  }
                  if (json.checkpoint_id) {
                    this.checkpointId = json.checkpoint_id;
                    console.log(
                      `${this.logPrefix} Checkpoint ID: ${this.checkpointId}`,
                    );
                  }

                  if (json.subtype === "error" || json.error) {
                    console.error(
                      `${this.logPrefix} System error:`,
                      JSON.stringify(json),
                    );
                    displayOutput += `[System Error: ${json.error || json.subtype || "unknown"}]\n`;
                  } else if (json.subtype !== "init") {
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
              // JSONパース失敗時は生のテキストとして処理
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
          lastOutputTime = Date.now();
          console.log(`${this.logPrefix} stderr: ${output.substring(0, 200)}`);
          this.emitOutput(output, true);
        });

        this.process.on("close", (code: number | null) => {
          cleanupTimeoutCheck();
          cleanupIdleCheck();
          const executionTimeMs = Date.now() - startTime;

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

          if (this.status === "cancelled") {
            resolve({
              success: false,
              output: this.outputBuffer,
              errorMessage: "Execution cancelled",
              executionTimeMs,
            });
            return;
          }

          if (this.status === "failed") {
            return;
          }

          const artifacts = this.parseArtifacts(this.outputBuffer);
          const commits = this.parseCommits(this.outputBuffer);

          // 質問検出
          const hasQuestion = this.detectedQuestion.hasQuestion;
          const question = this.detectedQuestion.question;
          const questionKey = this.detectedQuestion.questionKey;
          const questionDetails = this.detectedQuestion.questionDetails;
          const questionType = tolegacyQuestionType(
            this.detectedQuestion.questionType,
          );

          if (hasQuestion) {
            this.status = "waiting_for_input";
            console.log(
              `${this.logPrefix} Question detected: ${question.substring(0, 200)}`,
            );
            this.emitOutput(`\n${this.logPrefix} 回答を待っています...\n`);
            resolve({
              success: true,
              output: this.outputBuffer,
              artifacts,
              commits,
              executionTimeMs,
              waitingForInput: true,
              question,
              questionType,
              questionDetails,
              questionKey,
              // claudeSessionIdフィールドをセッション継続用に使用（チェックポイントID優先）
              claudeSessionId: this.checkpointId || this.geminiSessionId || undefined,
            });
            return;
          }

          this.status = code === 0 ? "completed" : "failed";

          let errorMessage: string | undefined;
          if (code !== 0) {
            const errorParts: string[] = [];
            errorParts.push(`プロセスがコード ${code} で終了しました`);

            if (this.errorBuffer.trim()) {
              errorParts.push(
                `\n\n【標準エラー出力】\n${this.errorBuffer.trim()}`,
              );
            }

            if (this.outputBuffer.trim()) {
              const lastOutput = this.outputBuffer.trim().slice(-1000);
              errorParts.push(`\n${lastOutput}`);
            }

            errorMessage = errorParts.join("");
          }

          resolve({
            success: code === 0,
            output: this.outputBuffer,
            artifacts,
            commits,
            executionTimeMs,
            waitingForInput: false,
            claudeSessionId: this.checkpointId || this.geminiSessionId || undefined,
            errorMessage,
          });
        });

        this.process.on("error", (error: Error) => {
          cleanupTimeoutCheck();
          cleanupIdleCheck();
          this.status = "failed";
          console.error(`${this.logPrefix} Process error:`, error);
          this.emitOutput(`${this.logPrefix} Error: ${error.message}\n`, true);

          const errorParts: string[] = [];
          errorParts.push(`プロセス起動エラー: ${error.message}`);

          if (this.errorBuffer.trim()) {
            errorParts.push(
              `\n\n【標準エラー出力】\n${this.errorBuffer.trim()}`,
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
        try {
          const pid = this.process.pid;
          if (pid) {
            const { execSync } = require("child_process");
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
            console.log(`${this.logPrefix} Process ${pid} killed via taskkill`);
          }
        } catch (e) {
          console.error(`${this.logPrefix} taskkill failed:`, e);
          try {
            this.process.kill();
          } catch {}
        }
      } else {
        this.process.kill("SIGINT");

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
      const geminiPath =
        process.env.GEMINI_CLI_PATH || (isWindows ? "gemini.cmd" : "gemini");
      const proc = spawn(geminiPath, ["--version"], { shell: true });

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

  async validateConfig(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Gemini CLIが利用可能か確認
    const available = await this.isAvailable();
    if (!available) {
      errors.push("Gemini CLI is not installed or not available in PATH. Install with: npm install -g @google/gemini-cli");
    }

    // APIキーの確認（Gemini CLIは無料版でもGoogleアカウントログインで利用可能）
    // GEMINI_API_KEY は必須ではない（Google認証でも動作する）
    // ただし、プロジェクトでAPIキーを使用する設定の場合は警告
    if (this.config.apiKey) {
      console.log(`${this.logPrefix} Using provided API key`);
    } else if (process.env.GEMINI_API_KEY) {
      console.log(`${this.logPrefix} Using GEMINI_API_KEY from environment`);
    } else {
      console.log(`${this.logPrefix} No API key provided - will use Google account authentication`);
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
   * タスクから構造化プロンプトを生成
   */
  private buildStructuredPrompt(task: AgentTask): string {
    // 最適化されたプロンプトがある場合はそれを使用
    if (task.optimizedPrompt) {
      console.log(
        `${this.logPrefix} Using optimized prompt (${task.optimizedPrompt.length} chars)`,
      );
      return task.optimizedPrompt;
    }

    const analysis = task.analysisInfo;

    if (!analysis) {
      return task.description || task.title;
    }

    const priorityLabels: Record<string, string> = {
      low: "低",
      medium: "中",
      high: "高",
      urgent: "緊急",
    };

    const complexityLabels: Record<string, string> = {
      simple: "シンプル",
      medium: "中程度",
      complex: "複雑",
    };

    const sections: string[] = [];

    sections.push("# タスク実装指示");
    sections.push("");
    sections.push("## 概要");
    sections.push(`**タスク名:** ${task.title}`);
    sections.push(`**分析サマリー:** ${analysis.summary}`);
    sections.push(
      `**複雑度:** ${complexityLabels[analysis.complexity] || analysis.complexity}`,
    );
    sections.push(`**推定総時間:** ${analysis.estimatedTotalHours}時間`);
    sections.push("");

    if (task.description) {
      sections.push("## タスク詳細");
      sections.push(task.description);
      sections.push("");
    }

    if (analysis.subtasks && analysis.subtasks.length > 0) {
      sections.push("## 実装手順");
      sections.push("以下の順序でタスクを実装してください：");
      sections.push("");

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

    if (analysis.reasoning) {
      sections.push("## 実装方針の根拠");
      sections.push(analysis.reasoning);
      sections.push("");
    }

    if (analysis.tips && analysis.tips.length > 0) {
      sections.push("## 実装のヒント");
      for (const tip of analysis.tips) {
        sections.push(`- ${tip}`);
      }
      sections.push("");
    }

    sections.push("## 実行指示");
    sections.push(
      "上記の手順に従って、タスクを最初から最後まで実装してください。",
    );
    sections.push("各ステップの完了後、次のステップに進んでください。");
    sections.push("不明点がある場合は、質問してください。");

    return sections.join("\n");
  }

  /**
   * 出力からファイル変更などの成果物を解析
   */
  private parseArtifacts(output: string): AgentArtifact[] {
    const artifacts: AgentArtifact[] = [];

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
            content: "",
            path: filePath,
          });
        }
      }
    }

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

    const commitPattern = /(?:Committed|commit)\s+([a-f0-9]{7,40})/gi;
    let match;
    while ((match = commitPattern.exec(output)) !== null) {
      commits.push({
        hash: match[1] || "",
        message: "",
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
        // Gemini CLI のビルトインツール
        case "ReadFile":
        case "Read":
          return input.file_path || input.path
            ? `-> ${String(input.file_path || input.path).split(/[/\\]/).pop()}`
            : "";
        case "WriteFile":
        case "Write":
          return input.file_path || input.path
            ? `-> ${String(input.file_path || input.path).split(/[/\\]/).pop()}`
            : "";
        case "Edit":
          return input.file_path
            ? `-> ${String(input.file_path).split(/[/\\]/).pop()}`
            : "";
        case "FindFiles":
        case "Glob":
          return input.pattern ? `pattern: ${input.pattern}` : "";
        case "SearchText":
        case "Grep":
          return input.pattern || input.query
            ? `pattern: ${input.pattern || input.query}`
            : "";
        case "Shell":
        case "Bash":
          const cmd = String(input.command || "");
          return cmd.length > 50 ? `$ ${cmd.substring(0, 50)}...` : `$ ${cmd}`;
        case "GoogleSearch":
          return input.query ? `"${input.query}"` : "";
        case "WebFetch":
          return input.url ? `-> ${String(input.url).substring(0, 40)}...` : "";
        case "CodebaseInvestigatorAgent":
          return input.query ? `"${input.query}"` : "";
        case "SaveMemory":
          return input.key ? `key: ${input.key}` : "";
        case "WriteTodos":
          return input.todos ? `${(input.todos as unknown[]).length} items` : "";
        default:
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

  /**
   * チェックポイントIDを取得（セッション継続用）
   */
  getCheckpointId(): string | null {
    return this.checkpointId;
  }

  /**
   * セッションIDを取得
   */
  getSessionId(): string | null {
    return this.geminiSessionId;
  }
}
