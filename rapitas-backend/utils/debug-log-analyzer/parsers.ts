/**
 * Debug Log Analyzer - Parser Implementations
 *
 * Defines parser classes for JSON, Syslog, Apache Common Log, and Node.js log formats.
 */

import { LogType, LogLevel, type ParsedLogEntry, type LogParser } from './types';

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
        type: this.type,
      };
    } catch {
      return null;
    }
  }

  private normalizeLogLevel(level?: string): LogLevel {
    if (!level) return LogLevel.INFO;
    const normalized = level.toLowerCase();

    switch (normalized) {
      case 'trace':
        return LogLevel.TRACE;
      case 'debug':
        return LogLevel.DEBUG;
      case 'info':
      case 'information':
        return LogLevel.INFO;
      case 'warn':
      case 'warning':
        return LogLevel.WARN;
      case 'error':
      case 'err':
        return LogLevel.ERROR;
      case 'fatal':
      case 'critical':
        return LogLevel.FATAL;
      default:
        return LogLevel.INFO;
    }
  }
}

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
        severity,
      },
      raw: logLine,
      type: this.type,
    };
  }

  private severityToLogLevel(severity: number): LogLevel {
    switch (severity) {
      case 0:
      case 1:
      case 2:
        return LogLevel.FATAL;
      case 3:
        return LogLevel.ERROR;
      case 4:
        return LogLevel.WARN;
      case 5:
      case 6:
        return LogLevel.INFO;
      case 7:
        return LogLevel.DEBUG;
      default:
        return LogLevel.INFO;
    }
  }
}

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
        user: user === '-' ? undefined : user,
        request,
        statusCode: status,
        size: size === '-' ? 0 : parseInt(size),
        type: 'http_access',
      },
      raw: logLine,
      type: this.type,
    };
  }

  private parseApacheDate(dateStr: string): Date {
    // Format: 01/Jan/2024:00:00:00 +0000
    const months: Record<string, number> = {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      May: 4,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11,
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
      parseInt(second),
    );
  }

  private statusCodeToLogLevel(status: number): LogLevel {
    if (status >= 500) return LogLevel.ERROR;
    if (status >= 400) return LogLevel.WARN;
    if (status >= 300) return LogLevel.INFO;
    return LogLevel.INFO;
  }
}

export class NodeJSLogParser implements LogParser {
  type = LogType.NODEJS;

  // Node.js format variations
  private readonly patterns = [
    // [2024-01-01T00:00:00.000Z] ERROR: Message
    /^\[([^\]]+)\]\s+(\w+):\s+(.*)$/,
    // ERROR [2024-01-01T00:00:00.000Z] Message
    /^(\w+)\s+\[([^\]]+)\]\s+(.*)$/,
    // 2024-01-01T00:00:00.000Z - ERROR - Message
    /^([^\s]+)\s+-\s+(\w+)\s+-\s+(.*)$/,
  ];

  canParse(logLine: string): boolean {
    return this.patterns.some((pattern) => pattern.test(logLine));
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
          type: this.type,
        };
      }
    }
    return null;
  }

  private normalizeLogLevel(level: string): LogLevel {
    const normalized = level.toLowerCase();
    switch (normalized) {
      case 'trace':
        return LogLevel.TRACE;
      case 'debug':
        return LogLevel.DEBUG;
      case 'info':
        return LogLevel.INFO;
      case 'warn':
      case 'warning':
        return LogLevel.WARN;
      case 'error':
        return LogLevel.ERROR;
      case 'fatal':
        return LogLevel.FATAL;
      default:
        return LogLevel.INFO;
    }
  }
}
