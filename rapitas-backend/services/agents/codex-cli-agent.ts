/**
 * Codex CLI エージェント
 * OpenAI Codex CLIを子プロセスとして起動し、タスクを実行する
 *
 * Codex CLI: @openai/codex (npm install -g @openai/codex)
 * https://github.com/openai/codex
 *
 * 主な機能:
 * - codex exec で非インタラクティブモードで実行
 * - --json でJSONストリーミング出力
 * - --full-auto で自動実行モード
 * - codex exec resume [SESSION_ID] でセッション再開
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

export type CodexCliAgentConfig = {
  workingDirectory?: string;
  model?: string; // gpt-5-codex, gpt-5 など
  timeout?: number; // milliseconds
  apiKey?: string; // OpenAI API Key
  fullAuto?: boolean; // --full-auto モード
  yolo?: boolean; // --yolo (--dangerously-bypass-approvals-and-sandbox)
  resumeSessionId?: string; // セッション再開用ID
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
};

export class CodexCliAgent extends BaseAgent {
  private process: ChildProcess | null = null;
  private config: CodexCliAgentConfig;
  private outputBuffer: string = "";
  private errorBuffer: string = "";
  private lineBuffer: string = "";
  /** 質問待機状態 */
  private detectedQuestion: QuestionWaitingState = createInitialWaitingState();
  private activeTools: Map<
    string,
    { name: string; startTime: number; info: string }
  > = new Map();
  /** Codex CLIのセッションID */
  private codexSessionId: string | null = null;

  constructor(id: string, name: string, config: CodexCliAgentConfig = {}) {
    super(id, name, "codex");
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
    this.codexSessionId = null;
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

    // Codex CLIが利用可能か確認
    const isCodexAvailable = await this.isAvailable();
    if (!isCodexAvailable) {
      this.status = "failed";
      return {
        success: false,
        output: "",
        errorMessage: `Codex CLI not found. Please install it with: npm install -g @openai/codex`,
        executionTimeMs: Date.now() - startTime,
      };
    }

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

      // Codex CLI コマンドを構築
      // codex exec PROMPT [options]
      const args: string[] = ["exec"];

      // セッション再開の場合
      const resumeId = this.config.resumeSessionId || task.resumeSessionId;
      if (resumeId) {
        args.push("resume", resumeId);
        console.log(`${this.logPrefix} Resuming session: ${resumeId}`);
      } else {
        // プロンプトを引数として渡す
        args.push(prompt);
      }

      // JSON出力
      args.push("--json");

      // 作業ディレクトリ
      args.push("--cd", workDir);

      // 自動実行モード
      if (this.config.yolo) {
        args.push("--yolo");
      } else if (this.config.fullAuto) {
        args.push("--full-auto");
      } else {
        // デフォルトはfull-auto（自動実行用途のため）
        args.push("--full-auto");
      }

      // モデル指定
      if (this.config.model) {
        args.push("-m", this.config.model);
      }

      // サンドボックスモード
      if (this.config.sandboxMode) {
        args.push("-s", this.config.sandboxMode);
      }

      const isWindows = process.platform === "win32";
      const codexPath =
        process.env.CODEX_CLI_PATH || (isWindows ? "codex.cmd" : "codex");

      console.log(`${this.logPrefix} Platform: ${process.platform}`);
      console.log(`${this.logPrefix} Codex path: ${codexPath}`);
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
        console.log(`${this.logPrefix} Spawn command: ${codexPath}`);

        let finalCommand: string;
        let finalArgs: string[];

        if (isWindows) {
          const argsString = args
            .map((arg) => {
              if (arg.includes(" ") || arg.includes("&") || arg.includes("|") || arg.includes("\n")) {
                return `"${arg.replace(/"/g, '\\"')}"`;
              }
              return arg;
            })
            .join(" ");
          finalCommand = `chcp 65001 >NUL 2>&1 && ${codexPath} ${argsString}`;
          finalArgs = [];
        } else {
          finalCommand = codexPath;
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
          env.OPENAI_API_KEY = this.config.apiKey;
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

        // stdinを閉じる（codex exec はプロンプトを引数で受け取る）
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
              `\n[警告] ${Math.floor(totalElapsed / 1000)}秒経過しましたが、Codex CLIからの応答がありません。処理を継続しています...\n`,
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

            // JSON形式の出力をパース
            try {
              const json = JSON.parse(line);
              const timestamp = new Date().toISOString();
              console.log(
                `${this.logPrefix} [${timestamp}] Event type: ${json.type}`,
              );

              let displayOutput = "";
              switch (json.type) {
                case "assistant":
                case "message":
                  // アシスタントのメッセージ
                  if (json.message?.content) {
                    for (const block of json.message.content) {
                      if (block.type === "text" && block.text) {
                        displayOutput += block.text;
                      } else if (block.type === "tool_use" || block.type === "function_call") {
                        // 質問ツールの検出
                        const toolName = block.name || block.function?.name;
                        if (toolName === "AskUserQuestion" || toolName === "ask_user") {
                          console.log(
                            `${this.logPrefix} Question tool detected: ${toolName}`,
                          );

                          const toolInput = block.input || block.function?.arguments;
                          const detectionResult = detectQuestionFromToolCall(
                            "AskUserQuestion",
                            toolInput,
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
                            toolName || "unknown",
                            block.input || block.function?.arguments,
                          );
                          displayOutput += `\n[Tool: ${toolName}] ${toolInfo}\n`;
                          if (block.id) {
                            this.activeTools.set(block.id, {
                              name: toolName || "unknown",
                              startTime: Date.now(),
                              info: toolInfo,
                            });
                          }
                        }
                      }
                    }
                  }
                  // contentが文字列の場合（簡易メッセージ形式）
                  if (typeof json.content === "string") {
                    displayOutput += json.content;
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
                  // セッションIDをキャプチャ
                  if (json.session_id) {
                    this.codexSessionId = json.session_id;
                    console.log(
                      `${this.logPrefix} Session ID: ${this.codexSessionId}`,
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
              // JSONパース失敗時: chcpコマンドの出力など不要な行をフィルタリング
              const trimmedLine = line.trim();
              if (
                !trimmedLine ||
                /^Active code page:/i.test(trimmedLine) ||
                /^現在のコード ページ:/i.test(trimmedLine) ||
                /^chcp\s/i.test(trimmedLine)
              ) {
                console.log(
                  `${this.logPrefix} Filtered non-JSON output: ${trimmedLine.substring(0, 100)}`,
                );
                continue;
              }
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
              claudeSessionId: this.codexSessionId || undefined,
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
            claudeSessionId: this.codexSessionId || undefined,
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
      const codexPath =
        process.env.CODEX_CLI_PATH || (isWindows ? "codex.cmd" : "codex");
      const proc = spawn(codexPath, ["--version"], { shell: true });

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

    const available = await this.isAvailable();
    if (!available) {
      errors.push("Codex CLI is not installed or not available in PATH. Install with: npm install -g @openai/codex");
    }

    // APIキーの確認
    if (this.config.apiKey) {
      console.log(`${this.logPrefix} Using provided API key`);
    } else if (process.env.OPENAI_API_KEY) {
      console.log(`${this.logPrefix} Using OPENAI_API_KEY from environment`);
    } else {
      console.log(`${this.logPrefix} No API key provided - will use ChatGPT account authentication`);
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
        case "Read":
        case "ReadFile":
          return input.file_path || input.path
            ? `-> ${String(input.file_path || input.path).split(/[/\\]/).pop()}`
            : "";
        case "Write":
        case "WriteFile":
          return input.file_path || input.path
            ? `-> ${String(input.file_path || input.path).split(/[/\\]/).pop()}`
            : "";
        case "Edit":
          return input.file_path
            ? `-> ${String(input.file_path).split(/[/\\]/).pop()}`
            : "";
        case "Glob":
        case "FindFiles":
          return input.pattern ? `pattern: ${input.pattern}` : "";
        case "Grep":
        case "SearchText":
          return input.pattern || input.query
            ? `pattern: ${input.pattern || input.query}`
            : "";
        case "Shell":
        case "Bash":
          const cmd = String(input.command || "");
          return cmd.length > 50 ? `$ ${cmd.substring(0, 50)}...` : `$ ${cmd}`;
        case "WebSearch":
          return input.query ? `"${input.query}"` : "";
        case "WebFetch":
          return input.url ? `-> ${String(input.url).substring(0, 40)}...` : "";
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
   * セッションIDを取得
   */
  getSessionId(): string | null {
    return this.codexSessionId;
  }
}
