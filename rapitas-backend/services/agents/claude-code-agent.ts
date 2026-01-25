/**
 * Claude Code CLI エージェント
 * Claude Code CLIを子プロセスとして起動し、タスクを実行する
 */

import { spawn, ChildProcess } from "child_process";
import { BaseAgent } from "./base-agent";
import type {
  AgentCapability,
  AgentTask,
  AgentExecutionResult,
  AgentArtifact,
  GitCommitInfo,
} from "./base-agent";

export type ClaudeCodeAgentConfig = {
  workingDirectory?: string;
  model?: string;
  dangerouslySkipPermissions?: boolean;
  timeout?: number; // milliseconds
  maxTokens?: number;
  continueConversation?: boolean; // 前回の会話を継続するか
};

export class ClaudeCodeAgent extends BaseAgent {
  private process: ChildProcess | null = null;
  private config: ClaudeCodeAgentConfig;
  private outputBuffer: string = "";
  private errorBuffer: string = "";

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
    const startTime = Date.now();

    // タイムアウトのデフォルト値を確実に設定
    const timeout = this.config.timeout ?? 900000; // 15分

    return new Promise(async (resolve, reject) => {
      const workDir =
        task.workingDirectory || this.config.workingDirectory || process.cwd();

      const fs = await import("fs/promises");

      // 作業ディレクトリの存在確認
      try {
        const stats = await fs.stat(workDir);
        if (!stats.isDirectory()) {
          this.status = "failed";
          resolve({
            success: false,
            output: "",
            errorMessage: `Working directory is not a directory: ${workDir}`,
            executionTimeMs: Date.now() - startTime,
          });
          return;
        }
      } catch (error) {
        this.status = "failed";
        resolve({
          success: false,
          output: "",
          errorMessage: `Working directory does not exist: ${workDir}`,
          executionTimeMs: Date.now() - startTime,
        });
        return;
      }

      // プロンプトを整形（Windows向けにエスケープ）
      const rawPrompt = task.description || task.title;
      const prompt = rawPrompt
        .replace(/\r\n/g, " ") // Windows改行をスペースに
        .replace(/\n/g, " ") // Unix改行をスペースに
        .replace(/"/g, '\\"'); // ダブルクォートをエスケープ

      // Claude Code CLI コマンドを構築
      const args: string[] = [];

      args.push("--print");

      // 前回の会話を継続する場合
      if (this.config.continueConversation) {
        args.push("--continue");
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

      // プロンプトを最後の引数として追加
      args.push(prompt);

      const claudePath = process.env.CLAUDE_CODE_PATH || "claude";

      const isClaudeAvailable = await this.isAvailable();
      if (!isClaudeAvailable) {
        this.status = "failed";
        resolve({
          success: false,
          output: "",
          errorMessage: `Claude Code CLI not found.`,
          executionTimeMs: Date.now() - startTime,
        });
        return;
      }

      console.log(`[Claude Code] ========================================`);
      console.log(`[Claude Code] Working directory: ${workDir}`);
      console.log(`[Claude Code] Prompt length: ${prompt.length} chars`);
      console.log(`[Claude Code] Timeout: ${timeout}ms`);
      console.log(`[Claude Code] Args: ${args.map(a => a.includes(" ") ? `"${a}"` : a).join(" ")}`);
      console.log(`[Claude Code] ========================================`);

      this.emitOutput(`[Claude Code] Starting execution...\n`);
      this.emitOutput(`[Claude Code] Working directory: ${workDir}\n`);
      this.emitOutput(`[Claude Code] Timeout: ${timeout / 1000}s\n`);
      this.emitOutput(
        `[Claude Code] Prompt: ${prompt.substring(0, 100)}${prompt.length > 100 ? "..." : ""}\n\n`,
      );

      try {
        this.process = spawn(claudePath, args, {
          cwd: workDir,
          shell: true,
          stdio: ["ignore", "pipe", "pipe"], // stdinを閉じる
          env: {
            ...process.env,
            FORCE_COLOR: "0",
            NO_COLOR: "1",
            CI: "1",
            TERM: "dumb",
          },
        });

        console.log(
          `[Claude Code] Process spawned with PID: ${this.process.pid}`,
        );
        this.emitOutput(`[Claude Code] Process PID: ${this.process.pid}\n`);

        // タイムアウト設定
        const timeoutId = setTimeout(() => {
          if (this.process && !this.process.killed) {
            console.log(`[Claude Code] TIMEOUT after ${timeout}ms`);
            console.log(
              `[Claude Code] Output so far: ${this.outputBuffer.substring(0, 500)}`,
            );
            console.log(
              `[Claude Code] Error so far: ${this.errorBuffer.substring(0, 500)}`,
            );
            this.emitOutput("\n[Claude Code] Execution timed out\n", true);
            this.process.kill("SIGTERM");
            this.status = "failed";
            resolve({
              success: false,
              output: this.outputBuffer,
              errorMessage: `Execution timed out after ${timeout / 1000}s`,
              executionTimeMs: Date.now() - startTime,
            });
          }
        }, timeout);

        this.process.stdout?.on("data", (data: Buffer) => {
          const output = data.toString();
          this.outputBuffer += output;
          console.log(
            `[Claude Code] stdout (${output.length} chars): ${output.substring(0, 200)}`,
          );
          this.emitOutput(output);
        });

        this.process.stderr?.on("data", (data: Buffer) => {
          const output = data.toString();
          this.errorBuffer += output;
          console.log(
            `[Claude Code] stderr (${output.length} chars): ${output.substring(0, 200)}`,
          );
          this.emitOutput(output, true);
        });

        this.process.on("close", (code: number | null) => {
          clearTimeout(timeoutId);
          const executionTimeMs = Date.now() - startTime;
          console.log(
            `[Claude Code] Process closed with code: ${code}, time: ${executionTimeMs}ms`,
          );
          console.log(
            `[Claude Code] Final output length: ${this.outputBuffer.length}`,
          );
          console.log(
            `[Claude Code] Last 500 chars of output: ${this.outputBuffer.slice(-500)}`,
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

          // 質問検出
          console.log(`[Claude Code] Running question detection...`);
          const { hasQuestion, question } = this.detectQuestion(
            this.outputBuffer
          );
          console.log(`[Claude Code] Question detection result - hasQuestion: ${hasQuestion}, question length: ${question.length}`);

          if (code === 0 && hasQuestion) {
            // 質問が検出された場合は入力待ち状態
            this.status = "waiting_for_input";
            console.log(`[Claude Code] Setting status to waiting_for_input`);
            console.log(`[Claude Code] Question detected: ${question.substring(0, 200)}`);
            this.emitOutput("\n[Claude Code] 回答を待っています...\n");
            resolve({
              success: true, // 技術的には成功だが、完了ではない
              output: this.outputBuffer,
              artifacts,
              commits,
              executionTimeMs,
              waitingForInput: true,
              question,
            });
            return;
          }

          console.log(`[Claude Code] No question detected, setting status to ${code === 0 ? "completed" : "failed"}`);
          this.status = code === 0 ? "completed" : "failed";

          resolve({
            success: code === 0,
            output: this.outputBuffer,
            artifacts,
            commits,
            executionTimeMs,
            waitingForInput: false,
            errorMessage:
              code !== 0
                ? this.errorBuffer || `Process exited with code ${code}`
                : undefined,
          });
        });

        this.process.on("error", (error: Error) => {
          clearTimeout(timeoutId);
          this.status = "failed";
          console.error(`[Claude Code] Process error:`, error);
          this.emitOutput(`[Claude Code] Error: ${error.message}\n`, true);
          resolve({
            success: false,
            output: this.outputBuffer,
            errorMessage: error.message,
            executionTimeMs: Date.now() - startTime,
          });
        });
      } catch (error) {
        this.status = "failed";
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(`[Claude Code] Spawn error:`, error);
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
      this.emitOutput("\n[Claude Code] Stopping execution...\n");

      // まずSIGINTを送信して丁寧に終了を試みる
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

      this.process = null;
    }
  }

  async pause(): Promise<boolean> {
    if (this.process && this.status === "running") {
      this.process.kill("SIGSTOP");
      this.status = "paused";
      this.emitOutput("\n[Claude Code] Execution paused\n");
      return true;
    }
    return false;
  }

  async resume(): Promise<boolean> {
    if (this.process && this.status === "paused") {
      this.process.kill("SIGCONT");
      this.status = "running";
      this.emitOutput("\n[Claude Code] Execution resumed\n");
      return true;
    }
    return false;
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const claudePath = process.env.CLAUDE_CODE_PATH || "claude";
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
   * 出力から質問/入力待ちを検出
   */
  private detectQuestion(output: string): { hasQuestion: boolean; question: string } {
    if (!output) return { hasQuestion: false, question: "" };

    // 最後の部分を取得（質問は通常最後に来る）
    const lines = output.split("\n").filter((l) => l.trim());
    const lastLines = lines.slice(-15).join("\n");

    // 質問パターン（英語）
    const questionPatterns = [
      /\?[\s]*$/m, // ?で終わる行
      /？[\s]*$/m, // ？（全角）で終わる行
      /please (choose|select|specify|confirm|provide|enter|tell me)/i,
      /which (one|option|file|directory|approach)/i,
      /do you want/i,
      /would you like/i,
      /should I/i,
      /can you (tell|specify|provide|confirm)/i,
      /what (is|are|should|would)/i,
      /enter (your|a|the)/i,
      /input:/i,
      /y\/n/i,
      /\[y\/N\]/i,
      /\[Y\/n\]/i,
      /waiting for.*input/i,
      /need.*clarification/i,
      /could you (clarify|specify|provide)/i,
      /before I proceed/i,
      /how would you like/i,
      // 日本語の質問パターン
      /ですか[？?]?[\s]*$/m,
      /ますか[？?]?[\s]*$/m,
      /しょうか[？?]?[\s]*$/m,
      /でしょうか[？?]?[\s]*$/m,
      /ください[。.]?[\s]*$/m,
      /どちら/,
      /どれ/,
      /どの/,
      /選択してください/,
      /選んでください/,
      /教えてください/,
      /確認してください/,
      /指定してください/,
      /入力してください/,
      // 選択肢パターン（番号付きリスト）
      /^\s*[1-9][)\.\]]/m, // 1) 2) 3) or 1. 2. 3.
      /^\s*[a-z][)\.\]]/im, // a) b) c)
      /（[1-9]）/m, // （1）（2）（3）
      /\([1-9]\)/m, // (1) (2) (3)
      // Claude Code特有のパターン
      /proceed\?/i,
      /continue\?/i,
      /のままでよい/,
      /変更しますか/,
      /実行しますか/,
      /よろしいですか/,
    ];

    const hasQuestion = questionPatterns.some((pattern) =>
      pattern.test(lastLines)
    );

    console.log(`[Claude Code] detectQuestion - lastLines: ${lastLines.substring(0, 200)}`);
    console.log(`[Claude Code] detectQuestion - hasQuestion: ${hasQuestion}`);

    if (hasQuestion) {
      // 質問部分を抽出（最後の数行で質問っぽいもの）
      const questionLines = lines.slice(-8).filter(
        (l) =>
          questionPatterns.some((p) => p.test(l)) ||
          l.trim().endsWith("?") ||
          l.trim().endsWith("？") ||
          /^\s*[1-9a-z][)\.\]]/i.test(l) // 選択肢の行
      );
      const extractedQuestion =
        questionLines.length > 0
          ? questionLines.join("\n")
          : lines.slice(-5).join("\n");

      console.log(`[Claude Code] detectQuestion - extractedQuestion: ${extractedQuestion.substring(0, 200)}`);
      return { hasQuestion: true, question: extractedQuestion };
    }

    return { hasQuestion: false, question: "" };
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
}
