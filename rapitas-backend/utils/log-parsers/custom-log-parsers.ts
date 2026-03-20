/**
 * Custom and Application Log Parsers
 *
 * Implements LogParser for Python logging format, a user-definable custom regex parser,
 * and the LogParserFactory that aggregates all available parsers.
 */

import { LogParser, LogType, LogLevel, ParsedLogEntry } from '../debug-log-analyzer';
import { NginxLogParser } from './http-log-parsers';
import { ApacheCombinedLogParser } from './http-log-parsers';
import {
  WindowsEventLogParser,
  DockerLogParser,
  PostgreSQLLogParser,
} from './system-log-parsers';

/** Field mapping configuration for the user-definable custom regex parser. */
export interface CustomFieldMapping {
  /** Ordered list of field names corresponding to each regex capture group. */
  groups: string[];
  /** Optional timestamp format; defaults to ISO 8601. */
  timestampFormat?: string;
}

/** Parses log lines using a user-supplied regex and field mapping. */
export class CustomFormatParser implements LogParser {
  type = LogType.CUSTOM;

  /**
   * @param pattern - Regular expression with capture groups / 正規表現（キャプチャグループあり）
   * @param fieldMap - Maps each capture group index to a field name / グループインデックスをフィールド名にマッピング
   */
  constructor(
    private pattern: RegExp,
    private fieldMap: CustomFieldMapping,
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
      metadata: {},
    };

    // Map matched groups to their corresponding fields
    match.slice(1).forEach((value, index) => {
      const fieldName = this.fieldMap.groups[index];
      if (!fieldName || !value) return;

      switch (fieldName) {
        case 'timestamp':
          entry.timestamp = this.parseTimestamp(value, this.fieldMap.timestampFormat);
          break;
        case 'level':
          entry.level = this.parseLevel(value);
          break;
        case 'message':
          entry.message = value;
          break;
        case 'source':
          entry.source = value;
          break;
        default:
          entry.metadata![fieldName] = value;
      }
    });

    return entry;
  }

  private parseTimestamp(value: string, format?: string): Date {
    if (!format || format === 'ISO8601') {
      return new Date(value);
    }

    // Fall back to the Date constructor for other formats
    return new Date(value);
  }

  private parseLevel(value: string): LogLevel {
    const normalized = value.toLowerCase();
    switch (normalized) {
      case 'trace': return LogLevel.TRACE;
      case 'debug': return LogLevel.DEBUG;
      case 'info':
      case 'information': return LogLevel.INFO;
      case 'warn':
      case 'warning': return LogLevel.WARN;
      case 'error':
      case 'err': return LogLevel.ERROR;
      case 'fatal':
      case 'critical': return LogLevel.FATAL;
      default: return LogLevel.INFO;
    }
  }
}

/** Parses Python standard-library logging output lines. */
export class PythonLogParser implements LogParser {
  type = LogType.CUSTOM;

  // Python logging format: 2024-01-01 00:00:00,000 - logger_name - LEVEL - message
  private readonly pattern =
    /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d{3})\s+-\s+(\S+)\s+-\s+(\w+)\s+-\s+(.*)$/;

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
        type: 'python',
      },
      raw: logLine,
      type: this.type,
    };
  }

  private mapPythonLevel(level: string): LogLevel {
    switch (level.toUpperCase()) {
      case 'DEBUG': return LogLevel.DEBUG;
      case 'INFO': return LogLevel.INFO;
      case 'WARNING': return LogLevel.WARN;
      case 'ERROR': return LogLevel.ERROR;
      case 'CRITICAL': return LogLevel.FATAL;
      default: return LogLevel.INFO;
    }
  }
}

/** Factory that creates instances of all built-in parsers or a single custom parser. */
export class LogParserFactory {
  /**
   * Returns one instance of every built-in parser.
   *
   * @returns Array of all available LogParser implementations / 全ビルトインパーサーの配列
   */
  static createAllParsers(): LogParser[] {
    return [
      new NginxLogParser(),
      new ApacheCombinedLogParser(),
      new WindowsEventLogParser(),
      new DockerLogParser(),
      new PostgreSQLLogParser(),
      new PythonLogParser(),
    ];
  }

  /**
   * Creates a custom parser from a user-supplied pattern and field mapping.
   *
   * @param pattern - Regex string or RegExp / 正規表現文字列またはRegExpオブジェクト
   * @param fieldMap - Field mapping for capture groups / キャプチャグループのフィールドマッピング
   * @returns Configured CustomFormatParser instance
   */
  static createCustomParser(
    pattern: string | RegExp,
    fieldMap: CustomFieldMapping,
  ): CustomFormatParser {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    return new CustomFormatParser(regex, fieldMap);
  }
}
