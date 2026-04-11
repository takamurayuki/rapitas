/**
 * HTTP Log Parsers
 *
 * Implements LogParser for Nginx and Apache Combined access log formats.
 * Does not handle system-level or application-level log formats.
 */

import { LogParser, LogType, LogLevel, ParsedLogEntry } from '../debug-log-analyzer';

/** Parses Nginx combined access log lines. */
export class NginxLogParser implements LogParser {
  type = LogType.NGINX;

  // Nginx combined format
  private readonly pattern =
    /^(\S+)\s+\S+\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\d+)\s+"([^"]+)"\s+"([^"]+)"$/;

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
        user: user === '-' ? undefined : user,
        request,
        statusCode: status,
        size: parseInt(size),
        referer: referer === '-' ? undefined : referer,
        userAgent,
        type: 'http_access',
      },
      raw: logLine,
      type: this.type,
    };
  }

  private parseNginxDate(dateStr: string): Date {
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
    return LogLevel.INFO;
  }
}

/** Parses Apache Combined Log Format access log lines. */
export class ApacheCombinedLogParser implements LogParser {
  type = LogType.APACHE_COMBINED;

  // Apache Combined Log format
  private readonly pattern =
    /^(\S+)\s+\S+\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\S+)\s+"([^"]+)"\s+"([^"]+)"$/;

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
        user: user === '-' ? undefined : user,
        request,
        statusCode: status,
        size: size === '-' ? 0 : parseInt(size),
        referer: referer === '-' ? undefined : referer,
        userAgent,
        type: 'http_access',
      },
      raw: logLine,
      type: this.type,
    };
  }

  private parseApacheDate(dateStr: string): Date {
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
    return LogLevel.INFO;
  }
}
