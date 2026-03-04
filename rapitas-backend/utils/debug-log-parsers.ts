/**
 * 追加のログパーサー実装
 * Nginx、Apache Combined、Windows Event Log、カスタムフォーマット対応
 */

import {
  LogParser,
  LogType,
  LogLevel,
  ParsedLogEntry
} from './debug-log-analyzer';

// Nginxログパーサー
export class NginxLogParser implements LogParser {
  type = LogType.NGINX;

  // Nginx combined format
  private readonly pattern = /^(\S+)\s+\S+\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\d+)\s+"([^"]+)"\s+"([^"]+)"$/;

  canParse(logLine: string): boolean {
    return this.pattern.test(logLine);
  }

  parse(logLine: string): ParsedLogEntry | null {
    const match = logLine.match(this.pattern);
    if (!match) return null;

    const [, ip, user, timestamp, request, statusCode, size, referer, userAgent] = match;
    const status = parseInt(statusCode);

    return {
      timestamp: this.parseNginxDate(timestamp),
      level: this.statusCodeToLogLevel(status),
      message: request,
      source: ip,
      metadata: {
        ip,
        user: user === "-" ? undefined : user,
        request,
        statusCode: status,
        size: parseInt(size),
        referer: referer === "-" ? undefined : referer,
        userAgent,
        type: "http_access"
      },
      raw: logLine,
      type: this.type
    };
  }

  private parseNginxDate(dateStr: string): Date {
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

// Apache Combined Logパーサー（Common Logの拡張）
export class ApacheCombinedLogParser implements LogParser {
  type = LogType.APACHE_COMBINED;

  // Apache Combined Log format
  private readonly pattern = /^(\S+)\s+\S+\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\S+)\s+"([^"]+)"\s+"([^"]+)"$/;

  canParse(logLine: string): boolean {
    return this.pattern.test(logLine);
  }

  parse(logLine: string): ParsedLogEntry | null {
    const match = logLine.match(this.pattern);
    if (!match) return null;

    const [, ip, user, timestamp, request, statusCode, size, referer, userAgent] = match;
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
        referer: referer === "-" ? undefined : referer,
        userAgent,
        type: "http_access"
      },
      raw: logLine,
      type: this.type
    };
  }

  private parseApacheDate(dateStr: string): Date {
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

// Windows Event Logパーサー（簡易版）
export class WindowsEventLogParser implements LogParser {
  type = LogType.CUSTOM;

  // Windows Event Log CSV format
  private readonly pattern = /^"([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)"$/;

  canParse(logLine: string): boolean {
    return this.pattern.test(logLine) || logLine.includes("Event[");
  }

  parse(logLine: string): ParsedLogEntry | null {
    const csvMatch = logLine.match(this.pattern);
    if (csvMatch) {
      const [, level, dateTime, source, eventId, category, message] = csvMatch;

      return {
        timestamp: new Date(dateTime),
        level: this.mapEventLevel(level),
        message,
        source,
        metadata: {
          eventId,
          category,
          type: "windows_event"
        },
        raw: logLine,
        type: this.type
      };
    }

    // Event[システムログ]形式
    const eventMatch = logLine.match(/Event\[([^\]]+)\]:\s*(.+)/);
    if (eventMatch) {
      const [, source, message] = eventMatch;
      return {
        message,
        source,
        level: this.detectLevelFromMessage(message),
        raw: logLine,
        type: this.type
      };
    }

    return null;
  }

  private mapEventLevel(level: string): LogLevel {
    switch (level.toLowerCase()) {
      case "information": return LogLevel.INFO;
      case "warning": return LogLevel.WARN;
      case "error": return LogLevel.ERROR;
      case "critical": return LogLevel.FATAL;
      default: return LogLevel.INFO;
    }
  }

  private detectLevelFromMessage(message: string): LogLevel {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("error") || lowerMessage.includes("fail")) {
      return LogLevel.ERROR;
    }
    if (lowerMessage.includes("warn")) {
      return LogLevel.WARN;
    }
    return LogLevel.INFO;
  }
}

// Dockerログパーサー
export class DockerLogParser implements LogParser {
  type = LogType.CUSTOM;

  canParse(logLine: string): boolean {
    return logLine.includes("docker") || this.isDockerJsonLog(logLine);
  }

  private isDockerJsonLog(logLine: string): boolean {
    try {
      const json = JSON.parse(logLine);
      return json.log && json.stream && json.time;
    } catch {
      return false;
    }
  }

  parse(logLine: string): ParsedLogEntry | null {
    // Docker JSONログ形式
    if (this.isDockerJsonLog(logLine)) {
      try {
        const json = JSON.parse(logLine);
        return {
          timestamp: new Date(json.time),
          level: json.stream === "stderr" ? LogLevel.ERROR : LogLevel.INFO,
          message: json.log.trim(),
          source: "docker",
          metadata: {
            stream: json.stream,
            containerId: json.containerId,
            type: "docker"
          },
          raw: logLine,
          type: this.type
        };
      } catch {
        return null;
      }
    }

    // Docker compose形式: container_name | message
    const composeMatch = logLine.match(/^([^\|]+)\s*\|\s*(.+)$/);
    if (composeMatch) {
      const [, container, message] = composeMatch;
      return {
        message: message.trim(),
        source: container.trim(),
        level: this.detectLevelFromMessage(message),
        raw: logLine,
        type: this.type
      };
    }

    return null;
  }

  private detectLevelFromMessage(message: string): LogLevel {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("error") || lowerMessage.includes("exception")) {
      return LogLevel.ERROR;
    }
    if (lowerMessage.includes("warn")) {
      return LogLevel.WARN;
    }
    if (lowerMessage.includes("debug")) {
      return LogLevel.DEBUG;
    }
    return LogLevel.INFO;
  }
}

// PostgreSQLログパーサー
export class PostgreSQLLogParser implements LogParser {
  type = LogType.CUSTOM;

  // PostgreSQL log line format
  private readonly pattern = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\w+)\s+\[(\d+)\]\s+(\w+):\s+(.*)$/;

  canParse(logLine: string): boolean {
    return this.pattern.test(logLine) || logLine.includes("postgres");
  }

  parse(logLine: string): ParsedLogEntry | null {
    const match = logLine.match(this.pattern);
    if (!match) return null;

    const [, timestamp, pid, level, message] = match;

    return {
      timestamp: new Date(timestamp),
      level: this.mapPostgresLevel(level),
      message,
      source: `postgres[${pid}]`,
      metadata: {
        pid: parseInt(pid),
        type: "postgresql"
      },
      raw: logLine,
      type: this.type
    };
  }

  private mapPostgresLevel(level: string): LogLevel {
    switch (level.toUpperCase()) {
      case "DEBUG": case "DEBUG1": case "DEBUG2": case "DEBUG3": case "DEBUG4": case "DEBUG5":
        return LogLevel.DEBUG;
      case "INFO": case "NOTICE": case "LOG":
        return LogLevel.INFO;
      case "WARNING":
        return LogLevel.WARN;
      case "ERROR":
        return LogLevel.ERROR;
      case "FATAL": case "PANIC":
        return LogLevel.FATAL;
      default:
        return LogLevel.INFO;
    }
  }
}

// カスタムフォーマットパーサー（ユーザー定義可能）
export class CustomFormatParser implements LogParser {
  type = LogType.CUSTOM;

  constructor(
    private pattern: RegExp,
    private fieldMap: CustomFieldMapping
  ) {}

  canParse(logLine: string): boolean {
    return this.pattern.test(logLine);
  }

  parse(logLine: string): ParsedLogEntry | null {
    const match = logLine.match(this.pattern);
    if (!match) return null;

    const entry: ParsedLogEntry = {
      raw: logLine,
      type: this.type,
      metadata: {}
    };

    // マッチしたグループを対応するフィールドにマップ
    match.slice(1).forEach((value, index) => {
      const fieldName = this.fieldMap.groups[index];
      if (!fieldName || !value) return;

      switch (fieldName) {
        case "timestamp":
          entry.timestamp = this.parseTimestamp(value, this.fieldMap.timestampFormat);
          break;
        case "level":
          entry.level = this.parseLevel(value);
          break;
        case "message":
          entry.message = value;
          break;
        case "source":
          entry.source = value;
          break;
        default:
          entry.metadata![fieldName] = value;
      }
    });

    return entry;
  }

  private parseTimestamp(value: string, format?: string): Date {
    // ISO8601形式の場合
    if (!format || format === "ISO8601") {
      return new Date(value);
    }

    // その他のフォーマットはそのままDateコンストラクタに渡す
    return new Date(value);
  }

  private parseLevel(value: string): LogLevel {
    const normalized = value.toLowerCase();
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

// カスタムフィールドマッピング
export interface CustomFieldMapping {
  groups: string[];
  timestampFormat?: string;
}

// Pythonログパーサー
export class PythonLogParser implements LogParser {
  type = LogType.CUSTOM;

  // Python logging format: 2024-01-01 00:00:00,000 - logger_name - LEVEL - message
  private readonly pattern = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d{3})\s+-\s+(\S+)\s+-\s+(\w+)\s+-\s+(.*)$/;

  canParse(logLine: string): boolean {
    return this.pattern.test(logLine);
  }

  parse(logLine: string): ParsedLogEntry | null {
    const match = logLine.match(this.pattern);
    if (!match) return null;

    const [, timestamp, logger, level, message] = match;

    return {
      timestamp: new Date(timestamp.replace(',', '.')),
      level: this.mapPythonLevel(level),
      message,
      source: logger,
      metadata: {
        logger,
        type: "python"
      },
      raw: logLine,
      type: this.type
    };
  }

  private mapPythonLevel(level: string): LogLevel {
    switch (level.toUpperCase()) {
      case "DEBUG": return LogLevel.DEBUG;
      case "INFO": return LogLevel.INFO;
      case "WARNING": return LogLevel.WARN;
      case "ERROR": return LogLevel.ERROR;
      case "CRITICAL": return LogLevel.FATAL;
      default: return LogLevel.INFO;
    }
  }
}

// パーサーファクトリー
export class LogParserFactory {
  static createAllParsers(): LogParser[] {
    return [
      new NginxLogParser(),
      new ApacheCombinedLogParser(),
      new WindowsEventLogParser(),
      new DockerLogParser(),
      new PostgreSQLLogParser(),
      new PythonLogParser()
    ];
  }

  static createCustomParser(
    pattern: string | RegExp,
    fieldMap: CustomFieldMapping
  ): CustomFormatParser {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    return new CustomFormatParser(regex, fieldMap);
  }
}