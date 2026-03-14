/**
 * ExecutionFileLogger
 *
 * Outputs execution logs in a structured format optimized for AI analysis.
 */

import { writeFile, mkdir, readdir, stat, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createLogger } from '../../config/logger';

const log = createLogger('execution-file-logger');

/**
 * Log event types.
 */
type LogEventType =
  | 'execution_start'
  | 'execution_end'
  | 'output'
  | 'error'
  | 'question_detected'
  | 'question_answered'
  | 'status_change'
  | 'git_commit'
  | 'config_loaded'
  | 'timeout'
  | 'shutdown'
  | 'recovery';

/**
 * Structured log entry.
 */
type StructuredLogEntry = {
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
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
 * Execution summary (appended at end of log file).
 */
type ExecutionSummary = {
  executionId: number;
  sessionId: number;
  taskId: number;
  taskTitle: string;
  agentType: string;
  agentName: string;
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
 * File logger configuration.
 */
type FileLoggerConfig = {
  logDir: string;
  maxLogFiles: number;
  maxLogSizeBytes: number;
  enableConsolePassthrough: boolean;
};

const DEFAULT_CONFIG: FileLoggerConfig = {
  logDir: path.join(process.cwd(), 'logs', 'agent-executions'),
  maxLogFiles: 100,
  maxLogSizeBytes: 50 * 1024 * 1024, // 50MB
  enableConsolePassthrough: true,
};

/**
 * Agent execution file logger.
 * Generates one log file per execution in a format optimized for AI analysis.
 */
export class ExecutionFileLogger {
  private config: FileLoggerConfig;
  private entries: StructuredLogEntry[] = [];
  private executionId: number;
  private sessionId: number;
  private taskId: number;
  private taskTitle: string;
  private agentType: string;
  private agentName: string;
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
    agentName?: string,
    modelId?: string,
    config?: Partial<FileLoggerConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.executionId = executionId;
    this.sessionId = sessionId;
    this.taskId = taskId;
    this.taskTitle = taskTitle;
    this.agentType = agentType;
    this.agentName = agentName || agentType;
    this.modelId = modelId;
    this.startedAt = new Date();

    // Log file path: logs/agent-executions/exec-{id}-{timestamp}.log
    const timestamp = this.startedAt.toISOString().replace(/[:.]/g, '-');
    this.logFilePath = path.join(this.config.logDir, `exec-${executionId}-${timestamp}.log`);
  }

  /**
   * Ensure the log directory exists.
   */
  private async ensureLogDir(): Promise<void> {
    if (this.initialized) return;
    try {
      if (!existsSync(this.config.logDir)) {
        await mkdir(this.config.logDir, { recursive: true });
      }
      this.initialized = true;
    } catch (e) {
      log.error({ err: e }, `[ExecutionFileLogger] Failed to create log directory`);
    }
  }

  /**
   * Add a log entry.
   */
  log(
    level: StructuredLogEntry['level'],
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
        code: 'code' in error ? (error as NodeJS.ErrnoException).code : undefined,
      };
      this.lastError = error.message;
    }

    if (level === 'ERROR' || level === 'FATAL') {
      this.errorCount++;
      if (!error) {
        this.lastError = message;
      }
    }
    if (level === 'WARN') {
      this.warningCount++;
    }

    this.entries.push(entry);

    if (this.config.enableConsolePassthrough) {
      const prefix = `[ExecLog:${this.executionId}]`;
      switch (level) {
        case 'ERROR':
        case 'FATAL':
          log.error(`${prefix} ${message}`);
          break;
        case 'WARN':
          log.warn(`${prefix} ${message}`);
          break;
        default:
          log.info(`${prefix} ${message}`);
      }
    }
  }

  /**
   * Record output data.
   */
  logOutput(output: string, isError: boolean): void {
    this.outputSize += Buffer.byteLength(output, 'utf-8');

    if (isError && output.trim()) {
      this.log('ERROR', 'error', `[stderr] ${output.trim()}`);
    }
    // NOTE: Normal output uses DEBUG level to avoid flooding — only non-empty output is recorded
    if (!isError && output.trim().length > 0) {
      this.log('DEBUG', 'output', output.trim());
    }
  }

  /**
   * Record execution start.
   */
  logExecutionStart(command: string, config: Record<string, unknown>): void {
    this.log(
      'INFO',
      'execution_start',
      `Execution started: ${command} [Agent: ${this.agentName} (${this.agentType})]`,
      {
        command,
        agentType: this.agentType,
        agentName: this.agentName,
        modelId: this.modelId,
        taskId: this.taskId,
        taskTitle: this.taskTitle,
        ...config,
      },
    );
  }

  /**
   * Record execution end.
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
    const level = status === 'completed' ? 'INFO' : status === 'failed' ? 'ERROR' : 'WARN';

    this.log(level, 'execution_end', `Execution ended with status: ${status}`, {
      status,
      durationMs,
      success: result?.success,
      tokensUsed: result?.tokensUsed,
      executionTimeMs: result?.executionTimeMs,
      errorMessage: result?.errorMessage,
    });
  }

  /**
   * Record status change.
   */
  logStatusChange(from: string, to: string, reason?: string): void {
    this.log('INFO', 'status_change', `Status changed: ${from} -> ${to}`, {
      fromStatus: from,
      toStatus: to,
      reason,
    });
  }

  /**
   * Record question detection.
   */
  logQuestionDetected(question: string, questionType: string, claudeSessionId?: string): void {
    this.log('INFO', 'question_detected', `Question detected: ${question.substring(0, 200)}`, {
      question,
      questionType,
      claudeSessionId,
    });
  }

  /**
   * Record question response.
   */
  logQuestionAnswered(response: string, source: 'user' | 'auto_timeout'): void {
    this.log(
      'INFO',
      'question_answered',
      `Question answered (${source}): ${response.substring(0, 200)}`,
      {
        response,
        source,
      },
    );
  }

  /**
   * Record a Git commit.
   */
  logGitCommit(commitInfo: Record<string, unknown>): void {
    this.log(
      'INFO',
      'git_commit',
      `Git commit: ${commitInfo.message || '(no message)'}`,
      commitInfo,
    );
  }

  /**
   * Record an error.
   */
  logError(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log('ERROR', 'error', message, context, error);
  }

  /**
   * Flush log entries to file in an AI-analysis-optimized format.
   */
  async flush(): Promise<string | null> {
    if (this.entries.length === 0) return null;

    try {
      await this.ensureLogDir();

      const durationMs = Date.now() - this.startedAt.getTime();

      const summary: ExecutionSummary = {
        executionId: this.executionId,
        sessionId: this.sessionId,
        taskId: this.taskId,
        taskTitle: this.taskTitle,
        agentType: this.agentType,
        agentName: this.agentName,
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

      const logContent = this.buildLogFileContent(summary);

      await writeFile(this.logFilePath, logContent, 'utf-8');

      await this.cleanupOldLogs();

      return this.logFilePath;
    } catch (e) {
      log.error({ err: e }, `[ExecutionFileLogger] Failed to write log file`);
      return null;
    }
  }

  /**
   * Build the log file content optimized for AI analysis.
   */
  private buildLogFileContent(summary: ExecutionSummary): string {
    const sections: string[] = [];

    // ============================================================
    // Section 1: Header & Summary
    // ============================================================
    sections.push(`${'='.repeat(80)}`);
    sections.push(`AGENT EXECUTION LOG`);
    sections.push(`${'='.repeat(80)}`);
    sections.push(``);
    sections.push(`[SUMMARY]`);
    sections.push(`  Execution ID  : ${summary.executionId}`);
    sections.push(`  Session ID    : ${summary.sessionId}`);
    sections.push(`  Task ID       : ${summary.taskId}`);
    sections.push(`  Task Title    : ${summary.taskTitle}`);
    sections.push(`  Agent Type    : ${summary.agentType}`);
    sections.push(`  Agent Name    : ${summary.agentName}`);
    if (summary.modelId) {
      sections.push(`  Model ID      : ${summary.modelId}`);
    }
    sections.push(`  Status        : ${summary.status}`);
    sections.push(`  Started At    : ${summary.startedAt}`);
    sections.push(`  Completed At  : ${summary.completedAt || 'N/A'}`);
    sections.push(
      `  Duration      : ${summary.durationMs ? `${(summary.durationMs / 1000).toFixed(1)}s` : 'N/A'}`,
    );
    if (summary.tokensUsed) {
      sections.push(`  Tokens Used   : ${summary.tokensUsed}`);
    }
    sections.push(`  Log Entries   : ${summary.totalLogEntries}`);
    sections.push(`  Errors        : ${summary.errorCount}`);
    sections.push(`  Warnings      : ${summary.warningCount}`);
    sections.push(`  Output Size   : ${(summary.outputSizeBytes / 1024).toFixed(1)} KB`);
    sections.push(``);

    // ============================================================
    // Section 2: Error Summary (if errors exist)
    // ============================================================
    const errorEntries = this.entries.filter((e) => e.level === 'ERROR' || e.level === 'FATAL');

    if (errorEntries.length > 0) {
      sections.push(`${'='.repeat(80)}`);
      sections.push(`[ERROR SUMMARY] (${errorEntries.length} errors found)`);
      sections.push(`${'='.repeat(80)}`);
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
            const stackLines = entry.error.stack.split('\n');
            for (const line of stackLines) {
              sections.push(`    ${line.trim()}`);
            }
          }
        }
        if (entry.context && Object.keys(entry.context).length > 0) {
          sections.push(
            `  Context  : ${JSON.stringify(entry.context, null, 2).split('\n').join('\n    ')}`,
          );
        }
        sections.push(``);
      }
    }

    // ============================================================
    // Section 3: Warning Summary (if warnings exist)
    // ============================================================
    const warnEntries = this.entries.filter((e) => e.level === 'WARN');

    if (warnEntries.length > 0) {
      sections.push(`${'='.repeat(80)}`);
      sections.push(`[WARNING SUMMARY] (${warnEntries.length} warnings found)`);
      sections.push(`${'='.repeat(80)}`);
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
    // Section 4: Full Log Entries (chronological)
    // ============================================================
    sections.push(`${'='.repeat(80)}`);
    sections.push(`[FULL EXECUTION LOG] (${this.entries.length} entries)`);
    sections.push(`${'='.repeat(80)}`);
    sections.push(``);

    for (const entry of this.entries) {
      const levelPad = entry.level.padEnd(5);
      const eventPad = entry.eventType.padEnd(20);

      if (entry.eventType === 'output' && entry.level === 'DEBUG') {
        const msg =
          entry.message.length > 500
            ? entry.message.substring(0, 500) + '... (truncated)'
            : entry.message;
        sections.push(`[${entry.timestamp}] [${levelPad}] [${eventPad}] ${msg}`);
        continue;
      }

      sections.push(`[${entry.timestamp}] [${levelPad}] [${eventPad}] ${entry.message}`);

      if (entry.context && Object.keys(entry.context).length > 0) {
        sections.push(
          `  Context: ${JSON.stringify(entry.context, null, 2).split('\n').join('\n  ')}`,
        );
      }

      if (entry.error) {
        sections.push(`  Error: ${entry.error.name}: ${entry.error.message}`);
        if (entry.error.stack) {
          sections.push(`  Stack:`);
          const stackLines = entry.error.stack.split('\n').slice(0, 10);
          for (const line of stackLines) {
            sections.push(`    ${line.trim()}`);
          }
        }
      }
    }

    sections.push(``);

    // ============================================================
    // Section 5: Structured Data (JSON)
    // ============================================================
    sections.push(`${'='.repeat(80)}`);
    sections.push(`[STRUCTURED DATA (JSON)]`);
    sections.push(`${'='.repeat(80)}`);
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

    return sections.join('\n');
  }

  /**
   * Get the latest status from log entries.
   */
  private getLatestStatus(): string {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry.eventType === 'execution_end' && entry.context?.status) {
        return String(entry.context.status);
      }
      if (entry.eventType === 'status_change' && entry.context?.toStatus) {
        return String(entry.context.toStatus);
      }
    }
    return 'unknown';
  }

  /**
   * Clean up old log files when exceeding maxLogFiles.
   */
  private async cleanupOldLogs(): Promise<void> {
    try {
      const files = await readdir(this.config.logDir);
      const logFiles = files
        .filter((f) => f.startsWith('exec-') && f.endsWith('.log'))
        .map((f) => path.join(this.config.logDir, f));

      if (logFiles.length <= this.config.maxLogFiles) return;

      const fileStats = await Promise.all(
        logFiles.map(async (f) => ({
          path: f,
          mtime: (await stat(f)).mtime,
        })),
      );
      fileStats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

      const deleteCount = fileStats.length - this.config.maxLogFiles;
      for (let i = 0; i < deleteCount; i++) {
        try {
          await unlink(fileStats[i].path);
        } catch {
        }
      }
    } catch {
    }
  }

  /**
   * Get the log file path.
   */
  getLogFilePath(): string {
    return this.logFilePath;
  }
}

/**
 * List execution log files.
 */
export async function listExecutionLogFiles(
  logDir?: string,
): Promise<Array<{ filename: string; path: string; size: number; mtime: Date }>> {
  const dir = logDir || DEFAULT_CONFIG.logDir;

  try {
    if (!existsSync(dir)) return [];

    const files = await readdir(dir);
    const logFiles = files.filter((f) => f.startsWith('exec-') && f.endsWith('.log'));

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

    results.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return results;
  } catch {
    return [];
  }
}

/**
 * Get the log file for a specific execution ID.
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
      (f) => f.startsWith(`exec-${executionId}-`) && f.endsWith('.log'),
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
