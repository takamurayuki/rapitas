/**
 * Debug Log Parsers Unit Tests
 *
 * Tests for individual log parser implementations.
 */
import { describe, test, expect } from 'bun:test';
import {
  JSONLogParser,
  SyslogParser,
  ApacheCommonLogParser,
  NodeJSLogParser,
  LogType,
  LogLevel,
} from '../../utils/debug-log-analyzer';

describe('JSONLogParser', () => {
  const parser = new JSONLogParser();

  test('JSON行をパースできること', () => {
    expect(parser.canParse('{"message":"hello"}')).toBe(true);
  });

  test('非JSON行はパースできないこと', () => {
    expect(parser.canParse('plain text log')).toBe(false);
  });

  test('JSONログを正しくパースすること', () => {
    const result = parser.parse('{"level":"error","message":"Something failed","source":"app"}');
    expect(result).not.toBeNull();
    expect(result!.level).toBe(LogLevel.ERROR);
    expect(result!.message).toBe('Something failed');
    expect(result!.source).toBe('app');
    expect(result!.type).toBe(LogType.JSON);
  });

  test('timestampをDateに変換すること', () => {
    const result = parser.parse('{"timestamp":"2024-01-15T10:30:00Z","message":"test"}');
    expect(result!.timestamp).toBeInstanceOf(Date);
  });

  test('msgフィールドもmessageとして扱うこと', () => {
    const result = parser.parse('{"msg":"hello from pino"}');
    expect(result!.message).toBe('hello from pino');
  });

  test('loggerフィールドをsourceとして扱うこと', () => {
    const result = parser.parse('{"logger":"my-service","message":"test"}');
    expect(result!.source).toBe('my-service');
  });

  test('severityフィールドをlevelとして扱うこと', () => {
    const result = parser.parse('{"severity":"warning","message":"test"}');
    expect(result!.level).toBe(LogLevel.WARN);
  });

  test('不明なレベルはINFOにフォールバックすること', () => {
    const result = parser.parse('{"level":"custom","message":"test"}');
    expect(result!.level).toBe(LogLevel.INFO);
  });

  test('レベルなしはINFOを返すこと', () => {
    const result = parser.parse('{"message":"test"}');
    expect(result!.level).toBe(LogLevel.INFO);
  });

  test('fatalレベルを正しく処理すること', () => {
    const result = parser.parse('{"level":"critical","message":"test"}');
    expect(result!.level).toBe(LogLevel.FATAL);
  });
});

describe('SyslogParser', () => {
  const parser = new SyslogParser();

  test('syslog形式をパースできること', () => {
    expect(parser.canParse('<34>Jan  5 14:30:00 myhost sshd[1234]: Connection accepted')).toBe(
      true,
    );
  });

  test('非syslog形式はパースできないこと', () => {
    expect(parser.canParse('plain text')).toBe(false);
  });

  test('syslogメッセージを正しくパースすること', () => {
    const result = parser.parse('<34>Jan  5 14:30:00 myhost sshd[1234]: Connection accepted');
    expect(result).not.toBeNull();
    expect(result!.message).toBe('Connection accepted');
    expect(result!.source).toBe('sshd[1234]');
    expect(result!.metadata!.hostname).toBe('myhost');
    expect(result!.metadata!.pid).toBe(1234);
  });

  test('severity 0-2をFATALにマッピングすること', () => {
    // priority=0 → facility=0, severity=0 → FATAL
    const result = parser.parse('<0>Jan  5 14:30:00 myhost kernel[0]: panic');
    expect(result!.level).toBe(LogLevel.FATAL);
  });

  test('severity 3をERRORにマッピングすること', () => {
    // priority=3 → facility=0, severity=3 → ERROR
    const result = parser.parse('<3>Jan  5 14:30:00 myhost app[100]: error occurred');
    expect(result!.level).toBe(LogLevel.ERROR);
  });

  test('severity 4をWARNにマッピングすること', () => {
    const result = parser.parse('<4>Jan  5 14:30:00 myhost app[100]: warning');
    expect(result!.level).toBe(LogLevel.WARN);
  });

  test('severity 7をDEBUGにマッピングすること', () => {
    const result = parser.parse('<7>Jan  5 14:30:00 myhost app[100]: debug info');
    expect(result!.level).toBe(LogLevel.DEBUG);
  });
});

describe('ApacheCommonLogParser', () => {
  const parser = new ApacheCommonLogParser();

  test('Apache Common Log形式をパースできること', () => {
    expect(
      parser.canParse(
        '127.0.0.1 - frank [10/Oct/2024:13:55:36 +0900] "GET /index.html HTTP/1.1" 200 2326',
      ),
    ).toBe(true);
  });

  test('Apache Common Logを正しくパースすること', () => {
    const result = parser.parse(
      '192.168.1.1 - admin [15/Jan/2024:10:30:00 +0000] "POST /api/data HTTP/1.1" 201 512',
    );
    expect(result).not.toBeNull();
    expect(result!.source).toBe('192.168.1.1');
    expect(result!.message).toBe('POST /api/data HTTP/1.1');
    expect(result!.metadata!.statusCode).toBe(201);
    expect(result!.metadata!.user).toBe('admin');
  });

  test('500番台のステータスをERRORにマッピングすること', () => {
    const result = parser.parse(
      '127.0.0.1 - - [10/Oct/2024:13:55:36 +0900] "GET /error HTTP/1.1" 500 0',
    );
    expect(result!.level).toBe(LogLevel.ERROR);
  });

  test('400番台のステータスをWARNにマッピングすること', () => {
    const result = parser.parse(
      '127.0.0.1 - - [10/Oct/2024:13:55:36 +0900] "GET /missing HTTP/1.1" 404 0',
    );
    expect(result!.level).toBe(LogLevel.WARN);
  });

  test('200番台のステータスをINFOにマッピングすること', () => {
    const result = parser.parse(
      '127.0.0.1 - - [10/Oct/2024:13:55:36 +0900] "GET /ok HTTP/1.1" 200 1234',
    );
    expect(result!.level).toBe(LogLevel.INFO);
  });

  test('user=-の場合undefinedを返すこと', () => {
    const result = parser.parse(
      '127.0.0.1 - - [10/Oct/2024:13:55:36 +0900] "GET / HTTP/1.1" 200 0',
    );
    expect(result!.metadata!.user).toBeUndefined();
  });
});

describe('NodeJSLogParser', () => {
  const parser = new NodeJSLogParser();

  test('パターン1をパースできること: [timestamp] LEVEL: message', () => {
    expect(parser.canParse('[2024-01-15T10:30:00.000Z] ERROR: Something went wrong')).toBe(true);
    const result = parser.parse('[2024-01-15T10:30:00.000Z] ERROR: Something went wrong');
    expect(result!.level).toBe(LogLevel.ERROR);
    expect(result!.message).toBe('Something went wrong');
  });

  test('パターン2をパースできること: LEVEL [timestamp] message', () => {
    expect(parser.canParse('WARN [2024-01-15T10:30:00.000Z] Disk space low')).toBe(true);
    const result = parser.parse('WARN [2024-01-15T10:30:00.000Z] Disk space low');
    expect(result!.level).toBe(LogLevel.WARN);
    expect(result!.message).toBe('Disk space low');
  });

  test('パターン3をパースできること: timestamp - LEVEL - message', () => {
    expect(parser.canParse('2024-01-15T10:30:00.000Z - INFO - Server started')).toBe(true);
    const result = parser.parse('2024-01-15T10:30:00.000Z - INFO - Server started');
    expect(result!.level).toBe(LogLevel.INFO);
    expect(result!.message).toBe('Server started');
  });

  test('非Node.js形式はパースできないこと', () => {
    expect(parser.canParse('just plain text')).toBe(false);
  });
});
