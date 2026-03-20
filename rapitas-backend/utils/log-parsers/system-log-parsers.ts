/**
 * System Log Parsers
 *
 * Implements LogParser for Windows Event Log, Docker, and PostgreSQL log formats.
 * Does not handle HTTP access logs or application-level log formats.
 */

import { LogParser, LogType, LogLevel, ParsedLogEntry } from '../debug-log-analyzer';

/** Parses Windows Event Log entries in both CSV and Event[...] formats. */
export class WindowsEventLogParser implements LogParser {
  type = LogType.CUSTOM;

  // Windows Event Log CSV format
  private readonly pattern = /^"([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)"$/;

  canParse(logLine: string): boolean {
    return this.pattern.test(logLine) || logLine.includes('Event[');
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
          type: 'windows_event',
        },
        raw: logLine,
        type: this.type,
      };
    }

    // Event[...] format
    const eventMatch = logLine.match(/Event\[([^\]]+)\]:\s*(.+)/);
    if (eventMatch) {
      const [, source, message] = eventMatch;
      return {
        message,
        source,
        level: this.detectLevelFromMessage(message),
        raw: logLine,
        type: this.type,
      };
    }

    return null;
  }

  private mapEventLevel(level: string): LogLevel {
    switch (level.toLowerCase()) {
      case 'information': return LogLevel.INFO;
      case 'warning': return LogLevel.WARN;
      case 'error': return LogLevel.ERROR;
      case 'critical': return LogLevel.FATAL;
      default: return LogLevel.INFO;
    }
  }

  private detectLevelFromMessage(message: string): LogLevel {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('error') || lowerMessage.includes('fail')) return LogLevel.ERROR;
    if (lowerMessage.includes('warn')) return LogLevel.WARN;
    return LogLevel.INFO;
  }
}

/** Parses Docker JSON log lines and Docker Compose pipe-prefixed lines. */
export class DockerLogParser implements LogParser {
  type = LogType.CUSTOM;

  canParse(logLine: string): boolean {
    return logLine.includes('docker') || this.isDockerJsonLog(logLine);
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
    // Docker JSON log format
    if (this.isDockerJsonLog(logLine)) {
      try {
        const json = JSON.parse(logLine);
        return {
          timestamp: new Date(json.time),
          level: json.stream === 'stderr' ? LogLevel.ERROR : LogLevel.INFO,
          message: json.log.trim(),
          source: 'docker',
          metadata: {
            stream: json.stream,
            containerId: json.containerId,
            type: 'docker',
          },
          raw: logLine,
          type: this.type,
        };
      } catch {
        return null;
      }
    }

    // Docker compose format: container_name | message
    const composeMatch = logLine.match(/^([^\|]+)\s*\|\s*(.+)$/);
    if (composeMatch) {
      const [, container, message] = composeMatch;
      return {
        message: message.trim(),
        source: container.trim(),
        level: this.detectLevelFromMessage(message),
        raw: logLine,
        type: this.type,
      };
    }

    return null;
  }

  private detectLevelFromMessage(message: string): LogLevel {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('error') || lowerMessage.includes('exception')) return LogLevel.ERROR;
    if (lowerMessage.includes('warn')) return LogLevel.WARN;
    if (lowerMessage.includes('debug')) return LogLevel.DEBUG;
    return LogLevel.INFO;
  }
}

/** Parses PostgreSQL server log lines. */
export class PostgreSQLLogParser implements LogParser {
  type = LogType.CUSTOM;

  // PostgreSQL log line format
  private readonly pattern =
    /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\w+)\s+\[(\d+)\]\s+(\w+):\s+(.*)$/;

  canParse(logLine: string): boolean {
    return this.pattern.test(logLine) || logLine.includes('postgres');
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
        type: 'postgresql',
      },
      raw: logLine,
      type: this.type,
    };
  }

  private mapPostgresLevel(level: string): LogLevel {
    switch (level.toUpperCase()) {
      case 'DEBUG':
      case 'DEBUG1':
      case 'DEBUG2':
      case 'DEBUG3':
      case 'DEBUG4':
      case 'DEBUG5':
        return LogLevel.DEBUG;
      case 'INFO':
      case 'NOTICE':
      case 'LOG':
        return LogLevel.INFO;
      case 'WARNING':
        return LogLevel.WARN;
      case 'ERROR':
        return LogLevel.ERROR;
      case 'FATAL':
      case 'PANIC':
        return LogLevel.FATAL;
      default:
        return LogLevel.INFO;
    }
  }
}
