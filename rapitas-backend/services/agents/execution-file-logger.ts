/**
 * エージェント実行ファイルロガー
 * 実行ログをAI分析しやすい構造化フォーマットでファイル出力する
 */

import { writeFile, mkdir, readdir, stat, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

/**
 * ログイベントの種別
 */
type LogEventType =
  | "execution_start"
  | "execution_end"
  | "output"
  | "error"
  | "question_detected"
  | "question_answered"
  | "status_change"
  | "git_commit"
  | "config_loaded"
  | "timeout"
  | "shutdown"
  | "recovery";

/**
 * 構造化ログエントリ
 */
type StructuredLogEntry = {
  timestamp: string;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";
  eventType: LogEventType;
  executionId: number;
  sessionId: number;
  taskId: number;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  duration?: number;
};

/**
 * 実行サマリー (ファイル末尾に追記)
 */
type ExecutionSummary = {
  executionId: number;
  sessionId: number;
  taskId: number;
  taskTitle: string;
  agentType: string;
  modelId?: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  tokensUsed?: number;
  totalLogEntries: number;
  errorCount: number;
  warningCount: number;
  lastError?: string;
  outputSizeBytes: number;
};

/**
 * ロガー設定
 */
type FileLoggerConfig = {
  logDir: string;
  maxLogFiles: number;
  maxLogSizeBytes: number;
  enableConsolePassthrough: boolean;
};

const DEFAULT_CONFIG: FileLoggerConfig = {
  logDir: path.join(process.cwd(), "logs", "agent-executions"),
  maxLogFiles: 100,
  maxLogSizeBytes: 50 * 1024 * 1024, // 50MB
  enableConsolePassthrough: true,
};

/**
 * エージェント実行ファイルロガー
 * 各実行ごとに1つのログファイルを生成し、AI分析に最適化された形式で出力する
 */
export class ExecutionFileLogger {
  private config: FileLoggerConfig;
  private entries: StructuredLogEntry[] = [];
  private executionId: number;
  private sessionId: number;
  private taskId: number;
  private taskTitle: string;
  private agentType: string;
  private modelId?: string;
  private startedAt: Date;
  private errorCount = 0;
  private warningCount = 0;
  private outputSize = 0;
  private lastError?: string;
  private logFilePath: string;
  private initialized = false;

  constructor(
    executionId: number,
    sessionId: number,
    taskId: number,
    taskTitle: string,
    agentType: string,
    modelId?: string,
    config?: Partial<FileLoggerConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.executionId = executionId;
    this.sessionId = sessionId;
    this.taskId = taskId;
    this.taskTitle = taskTitle;
    this.agentType = agentType;
    this.modelId = modelId;
    this.startedAt = new Date();

    // ログファイルパス: logs/agent-executions/exec-{id}-{timestamp}.log
    const timestamp = this.startedAt.toISOString().replace(/[:.]/g, "-");
    this.logFilePath = path.join(
      this.config.logDir,
      `exec-${executionId}-${timestamp}.log`,
    );
  }

  /**
   * ログディレクトリを初期化
   */
  private async ensureLogDir(): Promise<void> {
    if (this.initialized) return;
    try {
      if (!existsSync(this.config.logDir)) {
        await mkdir(this.config.logDir, { recursive: true });
      }
      this.initialized = true;
    } catch (e) {
      console.error(`[ExecutionFileLogger] Failed to create log directory: ${e}`);
    }
  }

  /**
   * ログエントリを追加
   */
  log(
    level: StructuredLogEntry["level"],
    eventType: LogEventType,
    message: string,
    context?: Record<string, unknown>,
    error?: Error,
  ): void {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      eventType,
      executionId: this.executionId,
      sessionId: this.sessionId,
      taskId: this.taskId,
      message,
      context,
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
      };
      this.lastError = error.message;
    }

    if (level === "ERROR" || level === "FATAL") {
      this.errorCount++;
      if (!error) {
        this.lastError = message;
      }
    }
    if (level === "WARN") {
      this.warningCount++;
    }

    this.entries.push(entry);

    // コンソールにもパススルー
    if (this.config.enableConsolePassthrough) {
      const prefix = `[ExecLog:${this.executionId}]`;
      switch (level) {
        case "ERROR":
        case "FATAL":
          console.error(`${prefix} ${message}`);
          break;
        case "WARN":
          console.warn(`${prefix} ${message}`);
          break;
        default:
          console.log(`${prefix} ${message}`);
      }
    }
  }

  /**
   * 出力データを記録
   */
  logOutput(output: string, isError: boolean): void {
    this.outputSize += Buffer.byteLength(output, "utf-8");

    if (isError && output.trim()) {
      this.log("ERROR", "error", `[stderr] ${output.trim()}`);
    }
    // 通常の出力は大量なのでDEBUGレベルにする (ファイルには記録)
    // ただし意味のある出力だけを記録
    if (!isError && output.trim().length > 0) {
      this.log("DEBUG", "output", output.trim());
    }
  }

  /**
   * 実行開始を記録
   */
  logExecutionStart(command: string, config: Record<string, unknown>): void {
    this.log("INFO", "execution_start", `Execution started: ${command}`, {
      command,
      agentType: this.agentType,
      modelId: this.modelId,
      taskId: this.taskId,
      taskTitle: this.taskTitle,
      ...config,
    });
  }

  /**
   * 実行完了を記録
   */
  logExecutionEnd(
    status: string,
    result?: {
      success?: boolean;
      tokensUsed?: number;
      executionTimeMs?: number;
      errorMessage?: string;
    },
  ): void {
    const durationMs = Date.now() - this.startedAt.getTime();
    const level = status === "completed" ? "INFO" : status === "failed" ? "ERROR" : "WARN";

    this.log(level, "execution_end", `Execution ended with status: ${status}`, {
      status,
      durationMs,
      success: result?.success,
      tokensUsed: result?.tokensUsed,
      executionTimeMs: result?.executionTimeMs,
      errorMessage: result?.errorMessage,
    });
  }

  /**
   * ステータス変更を記録
   */
  logStatusChange(from: string, to: string, reason?: string): void {
    this.log("INFO", "status_change", `Status changed: ${from} -> ${to}`, {
      fromStatus: from,
      toStatus: to,
      reason,
    });
  }

  /**
   * 質問検出を記録
   */
  logQuestionDetected(
    question: string,
    questionType: string,
    claudeSessionId?: string,
  ): void {
    this.log("INFO", "question_detected", `Question detected: ${question.substring(0, 200)}`, {
      question,
      questionType,
      claudeSessionId,
    });
  }

  /**
   * 質問応答を記録
   */
  logQuestionAnswered(response: string, source: "user" | "auto_timeout"): void {
    this.log("INFO", "question_answered", `Question answered (${source}): ${response.substring(0, 200)}`, {
      response,
      source,
    });
  }

  /**
   * Gitコミットを記録
   */
  logGitCommit(commitInfo: Record<string, unknown>): void {
    this.log("INFO", "git_commit", `Git commit: ${commitInfo.message || "(no message)"}`, commitInfo);
  }

  /**
   * エラーを記録
   */
  logError(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log("ERROR", "error", message, context, error);
  }

  /**
   * ログファイルに書き出し
   * AI分析に最適化されたフォーマットで出力する
   */
  async flush(): Promise<string | null> {
    if (this.entries.length === 0) return null;

    try {
      await this.ensureLogDir();

      const durationMs = Date.now() - this.startedAt.getTime();

      // サマリーを生成
      const summary: ExecutionSummary = {
        executionId: this.executionId,
        sessionId: this.sessionId,
        taskId: this.taskId,
        taskTitle: this.taskTitle,
        agentType: this.agentType,
        modelId: this.modelId,
        status: this.getLatestStatus(),
        startedAt: this.startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
        totalLogEntries: this.entries.length,
        errorCount: this.errorCount,
        warningCount: this.warningCount,
        lastError: this.lastError,
        outputSizeBytes: this.outputSize,
      };

      // AI分析しやすいフォーマットでログファイルを構築
      const logContent = this.buildLogFileContent(summary);

      await writeFile(this.logFilePath, logContent, "utf-8");

      // 古いログファイルをクリーンアップ
      await this.cleanupOldLogs();

      return this.logFilePath;
    } catch (e) {
      console.error(`[ExecutionFileLogger] Failed to write log file: ${e}`);
      return null;
    }
  }

  /**
   * AI分析に最適化されたログファイルの内容を構築
   */
  private buildLogFileContent(summary: ExecutionSummary): string {
    const sections: string[] = [];

    // ============================================================
    // Section 1: ヘッダー & サマリー
    // ============================================================
    sections.push(`${"=".repeat(80)}`);
    sections.push(`AGENT EXECUTION LOG`);
    sections.push(`${"=".repeat(80)}`);
    sections.push(``);
    sections.push(`[SUMMARY]`);
    sections.push(`  Execution ID  : ${summary.executionId}`);
    sections.push(`  Session ID    : ${summary.sessionId}`);
    sections.push(`  Task ID       : ${summary.taskId}`);
    sections.push(`  Task Title    : ${summary.taskTitle}`);
    sections.push(`  Agent Type    : ${summary.agentType}`);
    if (summary.modelId) {
      sections.push(`  Model ID      : ${summary.modelId}`);
    }
    sections.push(`  Status        : ${summary.status}`);
    sections.push(`  Started At    : ${summary.startedAt}`);
    sections.push(`  Completed At  : ${summary.completedAt || "N/A"}`);
    sections.push(`  Duration      : ${summary.durationMs ? `${(summary.durationMs / 1000).toFixed(1)}s` : "N/A"}`);
    if (summary.tokensUsed) {
      sections.push(`  Tokens Used   : ${summary.tokensUsed}`);
    }
    sections.push(`  Log Entries   : ${summary.totalLogEntries}`);
    sections.push(`  Errors        : ${summary.errorCount}`);
    sections.push(`  Warnings      : ${summary.warningCount}`);
    sections.push(`  Output Size   : ${(summary.outputSizeBytes / 1024).toFixed(1)} KB`);
    sections.push(``);

    // ============================================================
    // Section 2: エラーサマリー (エラーがある場合のみ)
    // ============================================================
    const errorEntries = this.entries.filter(
      (e) => e.level === "ERROR" || e.level === "FATAL",
    );

    if (errorEntries.length > 0) {
      sections.push(`${"=".repeat(80)}`);
      sections.push(`[ERROR SUMMARY] (${errorEntries.length} errors found)`);
      sections.push(`${"=".repeat(80)}`);
      sections.push(``);

      for (let i = 0; i < errorEntries.length; i++) {
        const entry = errorEntries[i];
        sections.push(`--- Error ${i + 1} / ${errorEntries.length} ---`);
        sections.push(`  Time     : ${entry.timestamp}`);
        sections.push(`  Event    : ${entry.eventType}`);
        sections.push(`  Message  : ${entry.message}`);
        if (entry.error) {
          sections.push(`  Error Name    : ${entry.error.name}`);
          sections.push(`  Error Message : ${entry.error.message}`);
          if (entry.error.code) {
            sections.push(`  Error Code    : ${entry.error.code}`);
          }
          if (entry.error.stack) {
            sections.push(`  Stack Trace   :`);
            const stackLines = entry.error.stack.split("\n");
            for (const line of stackLines) {
              sections.push(`    ${line.trim()}`);
            }
          }
        }
        if (entry.context && Object.keys(entry.context).length > 0) {
          sections.push(`  Context  : ${JSON.stringify(entry.context, null, 2).split("\n").join("\n    ")}`);
        }
        sections.push(``);
      }
    }

    // ============================================================
    // Section 3: 警告サマリー (警告がある場合のみ)
    // ============================================================
    const warnEntries = this.entries.filter((e) => e.level === "WARN");

    if (warnEntries.length > 0) {
      sections.push(`${"=".repeat(80)}`);
      sections.push(`[WARNING SUMMARY] (${warnEntries.length} warnings found)`);
      sections.push(`${"=".repeat(80)}`);
      sections.push(``);

      for (const entry of warnEntries) {
        sections.push(`  [${entry.timestamp}] ${entry.message}`);
        if (entry.context && Object.keys(entry.context).length > 0) {
          sections.push(`    Context: ${JSON.stringify(entry.context)}`);
        }
      }
      sections.push(``);
    }

    // ============================================================
    // Section 4: 全ログエントリ (時系列)
    // ============================================================
    sections.push(`${"=".repeat(80)}`);
    sections.push(`[FULL EXECUTION LOG] (${this.entries.length} entries)`);
    sections.push(`${"=".repeat(80)}`);
    sections.push(``);

    for (const entry of this.entries) {
      const levelPad = entry.level.padEnd(5);
      const eventPad = entry.eventType.padEnd(20);

      // 通常の出力はコンパクトに
      if (entry.eventType === "output" && entry.level === "DEBUG") {
        // 出力行が長すぎる場合は省略
        const msg = entry.message.length > 500
          ? entry.message.substring(0, 500) + "... (truncated)"
          : entry.message;
        sections.push(`[${entry.timestamp}] [${levelPad}] [${eventPad}] ${msg}`);
        continue;
      }

      sections.push(`[${entry.timestamp}] [${levelPad}] [${eventPad}] ${entry.message}`);

      if (entry.context && Object.keys(entry.context).length > 0) {
        sections.push(`  Context: ${JSON.stringify(entry.context, null, 2).split("\n").join("\n  ")}`);
      }

      if (entry.error) {
        sections.push(`  Error: ${entry.error.name}: ${entry.error.message}`);
        if (entry.error.stack) {
          sections.push(`  Stack:`);
          const stackLines = entry.error.stack.split("\n").slice(0, 10);
          for (const line of stackLines) {
            sections.push(`    ${line.trim()}`);
          }
        }
      }
    }

    sections.push(``);

    // ============================================================
    // Section 5: 構造化データ (JSON)
    // ============================================================
    sections.push(`${"=".repeat(80)}`);
    sections.push(`[STRUCTURED DATA (JSON)]`);
    sections.push(`${"=".repeat(80)}`);
    sections.push(``);
    sections.push(
      JSON.stringify(
        {
          summary,
          errors: errorEntries.map((e) => ({
            timestamp: e.timestamp,
            message: e.message,
            error: e.error,
            context: e.context,
          })),
          timeline: this.entries.map((e) => ({
            timestamp: e.timestamp,
            level: e.level,
            eventType: e.eventType,
            message: e.message.substring(0, 300),
          })),
        },
        null,
        2,
      ),
    );
    sections.push(``);

    return sections.join("\n");
  }

  /**
   * 最新のステータスを取得
   */
  private getLatestStatus(): string {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry.eventType === "execution_end" && entry.context?.status) {
        return String(entry.context.status);
      }
      if (entry.eventType === "status_change" && entry.context?.toStatus) {
        return String(entry.context.toStatus);
      }
    }
    return "unknown";
  }

  /**
   * 古いログファイルをクリーンアップ
   */
  private async cleanupOldLogs(): Promise<void> {
    try {
      const files = await readdir(this.config.logDir);
      const logFiles = files
        .filter((f) => f.startsWith("exec-") && f.endsWith(".log"))
        .map((f) => path.join(this.config.logDir, f));

      if (logFiles.length <= this.config.maxLogFiles) return;

      // 更新日時でソート (古い順)
      const fileStats = await Promise.all(
        logFiles.map(async (f) => ({
          path: f,
          mtime: (await stat(f)).mtime,
        })),
      );
      fileStats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

      // 古いファイルを削除
      const deleteCount = fileStats.length - this.config.maxLogFiles;
      for (let i = 0; i < deleteCount; i++) {
        try {
          await unlink(fileStats[i].path);
        } catch {
          // 削除失敗は無視
        }
      }
    } catch {
      // クリーンアップ失敗は無視
    }
  }

  /**
   * ログファイルのパスを取得
   */
  getLogFilePath(): string {
    return this.logFilePath;
  }
}

/**
 * ログファイルの一覧を取得
 */
export async function listExecutionLogFiles(
  logDir?: string,
): Promise<Array<{ filename: string; path: string; size: number; mtime: Date }>> {
  const dir = logDir || DEFAULT_CONFIG.logDir;

  try {
    if (!existsSync(dir)) return [];

    const files = await readdir(dir);
    const logFiles = files.filter((f) => f.startsWith("exec-") && f.endsWith(".log"));

    const results = await Promise.all(
      logFiles.map(async (f) => {
        const fullPath = path.join(dir, f);
        const fileStat = await stat(fullPath);
        return {
          filename: f,
          path: fullPath,
          size: fileStat.size,
          mtime: fileStat.mtime,
        };
      }),
    );

    // 更新日時の降順でソート
    results.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return results;
  } catch {
    return [];
  }
}

/**
 * 特定の実行IDに紐づくログファイルを取得
 */
export async function getExecutionLogFile(
  executionId: number,
  logDir?: string,
): Promise<{ filename: string; path: string; size: number; mtime: Date } | null> {
  const dir = logDir || DEFAULT_CONFIG.logDir;

  try {
    if (!existsSync(dir)) return null;

    const files = await readdir(dir);
    const matchingFile = files.find(
      (f) => f.startsWith(`exec-${executionId}-`) && f.endsWith(".log"),
    );

    if (!matchingFile) return null;

    const fullPath = path.join(dir, matchingFile);
    const fileStat = await stat(fullPath);
    return {
      filename: matchingFile,
      path: fullPath,
      size: fileStat.size,
      mtime: fileStat.mtime,
    };
  } catch {
    return null;
  }
}
