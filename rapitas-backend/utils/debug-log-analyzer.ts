/**
 * デバッグログ解析ツール
 * 様々な形式のログを解析し、構造化されたデータとして返す
 */

// ログのタイプ定義
export enum LogType {
  JSON = "json",
  SYSLOG = "syslog",
  APACHE_COMMON = "apache_common",
  APACHE_COMBINED = "apache_combined",
  NGINX = "nginx",
  NODEJS = "nodejs",
  CUSTOM = "custom",
  UNKNOWN = "unknown"
}

// ログレベルの定義
export enum LogLevel {
  TRACE = "trace",
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
  FATAL = "fatal"
}

// パースされたログエントリー
export interface ParsedLogEntry {
  timestamp?: Date;
  level?: LogLevel;
  message?: string;
  source?: string;
  metadata?: Record<string, any>;
  raw: string;
  type: LogType;
}

// ログ解析結果
export interface LogAnalysisResult {
  entries: ParsedLogEntry[];
  summary: {
    totalEntries: number;
    errorCount: number;
    warningCount: number;
    timeRange?: {
      start: Date;
      end: Date;
    };
    levelDistribution: Record<LogLevel, number>;
    sourceDistribution: Record<string, number>;
  };
  patterns: {
    errors: LogPattern[];
    warnings: LogPattern[];
    frequentMessages: LogPattern[];
  };
}

// ログパターン
export interface LogPattern {
  pattern: string;
  count: number;
  samples: ParsedLogEntry[];
  severity?: LogLevel;
}

// ログパーサーインターフェース
export interface LogParser {
  canParse(logLine: string): boolean;
  parse(logLine: string): ParsedLogEntry | null;
  type: LogType;
}

// JSONログパーサー
export class JSONLogParser implements LogParser {
  type = LogType.JSON;

  canParse(logLine: string): boolean {
    try {
      JSON.parse(logLine);
      return true;
    } catch {
      return false;
    }
  }

  parse(logLine: string): ParsedLogEntry | null {
    try {
      const json = JSON.parse(logLine);
      return {
        timestamp: json.timestamp ? new Date(json.timestamp) : undefined,
        level: this.normalizeLogLevel(json.level || json.severity),
        message: json.message || json.msg,
        source: json.source || json.logger,
        metadata: json,
        raw: logLine,
        type: this.type
      };
    } catch {
      return null;
    }
  }

  private normalizeLogLevel(level?: string): LogLevel {
    if (!level) return LogLevel.INFO;
    const normalized = level.toLowerCase();

    switch (normalized) {
      case "trace": return LogLevel.TRACE;
      case "debug": return LogLevel.DEBUG;
      case "info": case "information": return LogLevel.INFO;
      case "warn": case "warning": return LogLevel.WARN;
      case "error": case "err": return LogLevel.ERROR;
      case "fatal": case "critical": return LogLevel.FATAL;
      default: return LogLevel.INFO;
    }
  }
}

// Syslogパーサー
export class SyslogParser implements LogParser {
  type = LogType.SYSLOG;

  // Syslog format: <priority>timestamp hostname process[pid]: message
  private readonly pattern = /^<(\d+)>(\w+\s+\d+\s+\d+:\d+:\d+)\s+(\S+)\s+(\S+)\[(\d+)\]:\s+(.*)$/;

  canParse(logLine: string): boolean {
    return this.pattern.test(logLine);
  }

  parse(logLine: string): ParsedLogEntry | null {
    const match = logLine.match(this.pattern);
    if (!match) return null;

    const [, priority, timestamp, hostname, process, pid, message] = match;
    const severity = parseInt(priority) % 8;

    return {
      timestamp: new Date(timestamp),
      level: this.severityToLogLevel(severity),
      message,
      source: `${process}[${pid}]`,
      metadata: {
        hostname,
        process,
        pid: parseInt(pid),
        facility: Math.floor(parseInt(priority) / 8),
        severity
      },
      raw: logLine,
      type: this.type
    };
  }

  private severityToLogLevel(severity: number): LogLevel {
    switch (severity) {
      case 0: case 1: case 2: return LogLevel.FATAL;
      case 3: return LogLevel.ERROR;
      case 4: return LogLevel.WARN;
      case 5: case 6: return LogLevel.INFO;
      case 7: return LogLevel.DEBUG;
      default: return LogLevel.INFO;
    }
  }
}

// Apache Common Logパーサー
export class ApacheCommonLogParser implements LogParser {
  type = LogType.APACHE_COMMON;

  // Apache Common Log format: 127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET /index.html HTTP/1.1" 200 1234
  private readonly pattern = /^(\S+)\s+\S+\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\S+)$/;

  canParse(logLine: string): boolean {
    return this.pattern.test(logLine);
  }

  parse(logLine: string): ParsedLogEntry | null {
    const match = logLine.match(this.pattern);
    if (!match) return null;

    const [, ip, user, timestamp, request, statusCode, size] = match;
    const status = parseInt(statusCode);

    return {
      timestamp: this.parseApacheDate(timestamp),
      level: this.statusCodeToLogLevel(status),
      message: request,
      source: ip,
      metadata: {
        ip,
        user: user === "-" ? undefined : user,
        request,
        statusCode: status,
        size: size === "-" ? 0 : parseInt(size),
        type: "http_access"
      },
      raw: logLine,
      type: this.type
    };
  }

  private parseApacheDate(dateStr: string): Date {
    // Format: 01/Jan/2024:00:00:00 +0000
    const months: Record<string, number> = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
    };

    const match = dateStr.match(/(\d+)\/(\w+)\/(\d+):(\d+):(\d+):(\d+)\s+([\+\-]\d+)/);
    if (!match) return new Date();

    const [, day, month, year, hour, minute, second] = match;
    return new Date(
      parseInt(year),
      months[month] || 0,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    );
  }

  private statusCodeToLogLevel(status: number): LogLevel {
    if (status >= 500) return LogLevel.ERROR;
    if (status >= 400) return LogLevel.WARN;
    if (status >= 300) return LogLevel.INFO;
    return LogLevel.INFO;
  }
}

// Node.jsログパーサー
export class NodeJSLogParser implements LogParser {
  type = LogType.NODEJS;

  // Node.js format variations
  private readonly patterns = [
    // [2024-01-01T00:00:00.000Z] ERROR: Message
    /^\[([^\]]+)\]\s+(\w+):\s+(.*)$/,
    // ERROR [2024-01-01T00:00:00.000Z] Message
    /^(\w+)\s+\[([^\]]+)\]\s+(.*)$/,
    // 2024-01-01T00:00:00.000Z - ERROR - Message
    /^([^\s]+)\s+-\s+(\w+)\s+-\s+(.*)$/
  ];

  canParse(logLine: string): boolean {
    return this.patterns.some(pattern => pattern.test(logLine));
  }

  parse(logLine: string): ParsedLogEntry | null {
    for (const pattern of this.patterns) {
      const match = logLine.match(pattern);
      if (match) {
        let timestamp: string, level: string, message: string;

        if (pattern === this.patterns[0]) {
          [, timestamp, level, message] = match;
        } else if (pattern === this.patterns[1]) {
          [, level, timestamp, message] = match;
        } else {
          [, timestamp, level, message] = match;
        }

        return {
          timestamp: new Date(timestamp),
          level: this.normalizeLogLevel(level),
          message,
          raw: logLine,
          type: this.type
        };
      }
    }
    return null;
  }

  private normalizeLogLevel(level: string): LogLevel {
    const normalized = level.toLowerCase();
    switch (normalized) {
      case "trace": return LogLevel.TRACE;
      case "debug": return LogLevel.DEBUG;
      case "info": return LogLevel.INFO;
      case "warn": case "warning": return LogLevel.WARN;
      case "error": return LogLevel.ERROR;
      case "fatal": return LogLevel.FATAL;
      default: return LogLevel.INFO;
    }
  }
}

// メインのログアナライザー
export class DebugLogAnalyzer {
  private parsers: LogParser[] = [
    new JSONLogParser(),
    new SyslogParser(),
    new ApacheCommonLogParser(),
    new NodeJSLogParser()
  ];

  // カスタムパーサーを追加
  addParser(parser: LogParser): void {
    this.parsers.unshift(parser);
  }

  // ログタイプを検出
  detectLogType(logContent: string): LogType {
    const lines = logContent.split('\n').filter(line => line.trim());
    if (lines.length === 0) return LogType.UNKNOWN;

    // 最初の数行でタイプを判定
    const sampleLines = lines.slice(0, Math.min(10, lines.length));

    for (const parser of this.parsers) {
      const canParseAll = sampleLines.every(line => parser.canParse(line));
      if (canParseAll) return parser.type;
    }

    return LogType.UNKNOWN;
  }

  // ログを解析
  analyze(logContent: string, options?: AnalyzeOptions): LogAnalysisResult {
    const lines = logContent.split('\n').filter(line => line.trim());
    const entries: ParsedLogEntry[] = [];

    // 各行を解析
    for (const line of lines) {
      let parsed: ParsedLogEntry | null = null;

      for (const parser of this.parsers) {
        if (parser.canParse(line)) {
          parsed = parser.parse(line);
          if (parsed) break;
        }
      }

      // パースできなかった場合は生のログとして保存
      if (!parsed) {
        parsed = {
          raw: line,
          type: LogType.UNKNOWN,
          message: line
        };
      }

      entries.push(parsed);
    }

    // フィルタリング
    let filteredEntries = entries;
    if (options?.filter) {
      filteredEntries = this.filterEntries(entries, options.filter);
    }

    // 解析結果を生成
    return this.generateAnalysisResult(filteredEntries);
  }

  // エントリーのフィルタリング
  private filterEntries(entries: ParsedLogEntry[], filter: LogFilter): ParsedLogEntry[] {
    return entries.filter(entry => {
      if (filter.level && entry.level) {
        const levelPriority = this.getLogLevelPriority(entry.level);
        const filterPriority = this.getLogLevelPriority(filter.level);
        if (levelPriority < filterPriority) return false;
      }

      if (filter.startTime && entry.timestamp) {
        if (entry.timestamp < filter.startTime) return false;
      }

      if (filter.endTime && entry.timestamp) {
        if (entry.timestamp > filter.endTime) return false;
      }

      if (filter.source && entry.source) {
        if (!entry.source.includes(filter.source)) return false;
      }

      if (filter.searchText && entry.message) {
        if (!entry.message.toLowerCase().includes(filter.searchText.toLowerCase())) {
          return false;
        }
      }

      return true;
    });
  }

  // ログレベルの優先度
  private getLogLevelPriority(level: LogLevel): number {
    const priorities: Record<LogLevel, number> = {
      [LogLevel.TRACE]: 0,
      [LogLevel.DEBUG]: 1,
      [LogLevel.INFO]: 2,
      [LogLevel.WARN]: 3,
      [LogLevel.ERROR]: 4,
      [LogLevel.FATAL]: 5
    };
    return priorities[level] ?? 2;
  }

  // 解析結果の生成
  private generateAnalysisResult(entries: ParsedLogEntry[]): LogAnalysisResult {
    const levelDistribution: Record<LogLevel, number> = {
      [LogLevel.TRACE]: 0,
      [LogLevel.DEBUG]: 0,
      [LogLevel.INFO]: 0,
      [LogLevel.WARN]: 0,
      [LogLevel.ERROR]: 0,
      [LogLevel.FATAL]: 0
    };

    const sourceDistribution: Record<string, number> = {};
    const messagePatterns = new Map<string, LogPattern>();
    let errorCount = 0;
    let warningCount = 0;
    let minTime: Date | undefined;
    let maxTime: Date | undefined;

    // エントリーの解析
    for (const entry of entries) {
      // レベル分布
      if (entry.level) {
        levelDistribution[entry.level]++;
        if (entry.level === LogLevel.ERROR || entry.level === LogLevel.FATAL) {
          errorCount++;
        } else if (entry.level === LogLevel.WARN) {
          warningCount++;
        }
      }

      // ソース分布
      if (entry.source) {
        sourceDistribution[entry.source] = (sourceDistribution[entry.source] || 0) + 1;
      }

      // 時間範囲
      if (entry.timestamp) {
        if (!minTime || entry.timestamp < minTime) minTime = entry.timestamp;
        if (!maxTime || entry.timestamp > maxTime) maxTime = entry.timestamp;
      }

      // メッセージパターン
      if (entry.message) {
        const pattern = this.extractPattern(entry.message);
        if (!messagePatterns.has(pattern)) {
          messagePatterns.set(pattern, {
            pattern,
            count: 0,
            samples: [],
            severity: entry.level
          });
        }
        const patternData = messagePatterns.get(pattern)!;
        patternData.count++;
        if (patternData.samples.length < 3) {
          patternData.samples.push(entry);
        }
      }
    }

    // パターンを分類
    const patterns = Array.from(messagePatterns.values());
    const errorPatterns = patterns.filter(p =>
      p.severity === LogLevel.ERROR || p.severity === LogLevel.FATAL
    );
    const warningPatterns = patterns.filter(p => p.severity === LogLevel.WARN);
    const frequentPatterns = patterns
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      entries,
      summary: {
        totalEntries: entries.length,
        errorCount,
        warningCount,
        timeRange: minTime && maxTime ? { start: minTime, end: maxTime } : undefined,
        levelDistribution,
        sourceDistribution
      },
      patterns: {
        errors: errorPatterns,
        warnings: warningPatterns,
        frequentMessages: frequentPatterns
      }
    };
  }

  // メッセージからパターンを抽出（数値や特定の文字列を正規化）
  private extractPattern(message: string): string {
    return message
      .replace(/\b\d+\b/g, '{NUMBER}')
      .replace(/\b[0-9a-fA-F]{8,}\b/g, '{HEX}')
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '{IP}')
      .replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, '{EMAIL}')
      .replace(/\/[^\/\s]+/g, '{PATH}');
  }

  // ログのストリーム解析（大きなファイル用）
  async *analyzeStream(
    logStream: AsyncIterable<string>,
    options?: AnalyzeOptions
  ): AsyncGenerator<ParsedLogEntry> {
    for await (const line of logStream) {
      if (!line.trim()) continue;

      let parsed: ParsedLogEntry | null = null;
      for (const parser of this.parsers) {
        if (parser.canParse(line)) {
          parsed = parser.parse(line);
          if (parsed) break;
        }
      }

      if (!parsed) {
        parsed = {
          raw: line,
          type: LogType.UNKNOWN,
          message: line
        };
      }

      // フィルタリング
      if (options?.filter) {
        const filtered = this.filterEntries([parsed], options.filter);
        if (filtered.length === 0) continue;
      }

      yield parsed;
    }
  }
}

// 解析オプション
export interface AnalyzeOptions {
  filter?: LogFilter;
  limit?: number;
}

// ログフィルター
export interface LogFilter {
  level?: LogLevel;
  startTime?: Date;
  endTime?: Date;
  source?: string;
  searchText?: string;
}

// デフォルトのエクスポート
export default DebugLogAnalyzer;