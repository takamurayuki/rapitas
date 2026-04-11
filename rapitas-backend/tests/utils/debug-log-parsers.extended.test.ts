/**
 * Debug Log Parsers Extended Tests
 *
 * Tests for specialized log parser implementations.
 */
import { describe, test, expect } from 'bun:test';
import {
  NginxLogParser,
  ApacheCombinedLogParser,
  WindowsEventLogParser,
  DockerLogParser,
  PostgreSQLLogParser,
  PythonLogParser,
  CustomFormatParser,
} from '../../utils/common/debug-log-parsers';
import { LogType, LogLevel } from '../../utils/debug-log-analyzer';

describe('NginxLogParser', () => {
  const parser = new NginxLogParser();

  const sampleLine =
    '192.168.1.1 - admin [15/Jan/2024:10:30:00 +0000] "GET /api/data HTTP/1.1" 200 512 "https://example.com" "Mozilla/5.0"';

  test('Nginx combined形式をパースできること', () => {
    expect(parser.canParse(sampleLine)).toBe(true);
  });

  test('Nginx combined形式を正しくパースすること', () => {
    const result = parser.parse(sampleLine);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('192.168.1.1');
    expect(result!.message).toBe('GET /api/data HTTP/1.1');
    expect(result!.metadata!.statusCode).toBe(200);
    expect(result!.metadata!.size).toBe(512);
    expect(result!.metadata!.referer).toBe('https://example.com');
    expect(result!.metadata!.userAgent).toBe('Mozilla/5.0');
    expect(result!.metadata!.user).toBe('admin');
  });

  test('500番台をERRORにマッピングすること', () => {
    const line = '10.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 502 0 "-" "curl"';
    const result = parser.parse(line);
    expect(result!.level).toBe(LogLevel.ERROR);
  });

  test('404をWARNにマッピングすること', () => {
    const line =
      '10.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET /missing HTTP/1.1" 404 0 "-" "curl"';
    const result = parser.parse(line);
    expect(result!.level).toBe(LogLevel.WARN);
  });

  test('user=-の場合undefinedを返すこと', () => {
    const line = '10.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 0 "-" "curl"';
    const result = parser.parse(line);
    expect(result!.metadata!.user).toBeUndefined();
  });

  test('referer=-の場合undefinedを返すこと', () => {
    const line = '10.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 0 "-" "curl"';
    const result = parser.parse(line);
    expect(result!.metadata!.referer).toBeUndefined();
  });

  test('非Nginx形式はパースできないこと', () => {
    expect(parser.canParse('plain text')).toBe(false);
  });
});

describe('ApacheCombinedLogParser', () => {
  const parser = new ApacheCombinedLogParser();

  test('Apache Combined形式をパースできること', () => {
    const line =
      '127.0.0.1 - frank [10/Oct/2024:13:55:36 +0900] "GET /index.html HTTP/1.1" 200 2326 "http://www.example.com/" "Mozilla/5.0"';
    expect(parser.canParse(line)).toBe(true);
    const result = parser.parse(line);
    expect(result).not.toBeNull();
    expect(result!.metadata!.referer).toBe('http://www.example.com/');
    expect(result!.metadata!.userAgent).toBe('Mozilla/5.0');
  });

  test('size=-の場合0を返すこと', () => {
    const line =
      '127.0.0.1 - - [10/Oct/2024:13:55:36 +0900] "GET / HTTP/1.1" 304 - "http://example.com" "Mozilla"';
    const result = parser.parse(line);
    expect(result!.metadata!.size).toBe(0);
  });
});

describe('WindowsEventLogParser', () => {
  const parser = new WindowsEventLogParser();

  test('CSV形式のWindowsイベントログをパースできること', () => {
    const line =
      '"Information","2024-01-15 10:30:00","Application","1000","General","Application started"';
    expect(parser.canParse(line)).toBe(true);
    const result = parser.parse(line);
    expect(result).not.toBeNull();
    expect(result!.level).toBe(LogLevel.INFO);
    expect(result!.message).toBe('Application started');
    expect(result!.source).toBe('Application');
  });

  test('Warning/Error/Criticalレベルをマッピングすること', () => {
    const warning = '"Warning","2024-01-15","Service","100","Cat","Low disk"';
    expect(parser.parse(warning)!.level).toBe(LogLevel.WARN);

    const error = '"Error","2024-01-15","Service","100","Cat","Failed"';
    expect(parser.parse(error)!.level).toBe(LogLevel.ERROR);

    const critical = '"Critical","2024-01-15","Service","100","Cat","Crash"';
    expect(parser.parse(critical)!.level).toBe(LogLevel.FATAL);
  });

  test('Event[source]形式をパースできること', () => {
    const line = 'Event[System]: An error occurred in the service';
    expect(parser.canParse(line)).toBe(true);
    const result = parser.parse(line);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('System');
    expect(result!.message).toBe('An error occurred in the service');
    expect(result!.level).toBe(LogLevel.ERROR);
  });

  test('Event形式でwarnを含むメッセージはWARNを返すこと', () => {
    const line = 'Event[App]: Warning: disk space low';
    const result = parser.parse(line);
    expect(result!.level).toBe(LogLevel.WARN);
  });

  test('Event形式で通常メッセージはINFOを返すこと', () => {
    const line = 'Event[App]: Service started successfully';
    const result = parser.parse(line);
    expect(result!.level).toBe(LogLevel.INFO);
  });
});

describe('DockerLogParser', () => {
  const parser = new DockerLogParser();

  test('dockerキーワードを含む行はパース可能と判定すること', () => {
    expect(parser.canParse('docker: container started')).toBe(true);
  });

  test('Docker compose形式をパースできること', () => {
    const line = 'my-container | Server running on port 3000';
    const result = parser.parse(line);
    expect(result).not.toBeNull();
    expect(result!.message).toBe('Server running on port 3000');
    expect(result!.source).toBe('my-container');
  });
});

describe('PostgreSQLLogParser', () => {
  const parser = new PostgreSQLLogParser();

  test('PostgreSQL形式をパースできること', () => {
    const line = '2024-01-15 10:30:00.123 UTC [12345] LOG:  statement: SELECT 1';
    expect(parser.canParse(line)).toBe(true);
    const result = parser.parse(line);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('statement: SELECT 1');
    expect(result!.source).toBe('postgres[12345]');
    expect(result!.level).toBe(LogLevel.INFO);
  });

  test('各レベルを正しくマッピングすること', () => {
    const debug = '2024-01-15 10:30:00.123 UTC [1] DEBUG:  test';
    expect(parser.parse(debug)!.level).toBe(LogLevel.DEBUG);

    const warning = '2024-01-15 10:30:00.123 UTC [1] WARNING:  test';
    expect(parser.parse(warning)!.level).toBe(LogLevel.WARN);

    const error = '2024-01-15 10:30:00.123 UTC [1] ERROR:  test';
    expect(parser.parse(error)!.level).toBe(LogLevel.ERROR);

    const fatal = '2024-01-15 10:30:00.123 UTC [1] FATAL:  test';
    expect(parser.parse(fatal)!.level).toBe(LogLevel.FATAL);

    const panic = '2024-01-15 10:30:00.123 UTC [1] PANIC:  test';
    expect(parser.parse(panic)!.level).toBe(LogLevel.FATAL);
  });

  test('postgresキーワードを含む行はパース可能と判定すること', () => {
    expect(parser.canParse('postgres connection established')).toBe(true);
  });
});

describe('PythonLogParser', () => {
  const parser = new PythonLogParser();

  test('Python logging形式をパースできること', () => {
    const line = '2024-01-15 10:30:00,123 - my_module - ERROR - Something failed';
    expect(parser.canParse(line)).toBe(true);
    const result = parser.parse(line);
    expect(result).not.toBeNull();
    expect(result!.level).toBe(LogLevel.ERROR);
    expect(result!.message).toBe('Something failed');
    expect(result!.source).toBe('my_module');
  });

  test('各レベルを正しくマッピングすること', () => {
    const debug = '2024-01-15 10:30:00,000 - app - DEBUG - debug msg';
    expect(parser.parse(debug)!.level).toBe(LogLevel.DEBUG);

    const info = '2024-01-15 10:30:00,000 - app - INFO - info msg';
    expect(parser.parse(info)!.level).toBe(LogLevel.INFO);

    const warning = '2024-01-15 10:30:00,000 - app - WARNING - warn msg';
    expect(parser.parse(warning)!.level).toBe(LogLevel.WARN);

    const critical = '2024-01-15 10:30:00,000 - app - CRITICAL - critical msg';
    expect(parser.parse(critical)!.level).toBe(LogLevel.FATAL);
  });
});

describe('CustomFormatParser', () => {
  test('カスタムパターンでパースできること', () => {
    const parser = new CustomFormatParser(/^\[(\w+)\] (\w+): (.+)$/, {
      groups: ['source', 'level', 'message'],
    });

    expect(parser.canParse('[MyApp] ERROR: Something broke')).toBe(true);
    const result = parser.parse('[MyApp] ERROR: Something broke');
    expect(result).not.toBeNull();
    expect(result!.source).toBe('MyApp');
    expect(result!.level).toBe(LogLevel.ERROR);
    expect(result!.message).toBe('Something broke');
  });

  test('timestampフィールドをDateに変換すること', () => {
    const parser = new CustomFormatParser(/^(\S+) (.+)$/, { groups: ['timestamp', 'message'] });

    const result = parser.parse('2024-01-15T10:30:00Z Hello');
    expect(result!.timestamp).toBeInstanceOf(Date);
  });

  test('不明なフィールドはmetadataに格納すること', () => {
    const parser = new CustomFormatParser(/^(\w+) (\w+) (.+)$/, {
      groups: ['customField', 'level', 'message'],
    });

    const result = parser.parse('value1 INFO hello');
    expect(result!.metadata!.customField).toBe('value1');
  });

  test('マッチしない行はnullを返すこと', () => {
    const parser = new CustomFormatParser(/^SPECIFIC:/, { groups: [] });
    expect(parser.parse('different format')).toBeNull();
  });
});
