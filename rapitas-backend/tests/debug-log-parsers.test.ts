import { describe, test, expect } from 'bun:test';
import {
  NginxLogParser,
  ApacheCombinedLogParser,
  WindowsEventLogParser,
  DockerLogParser,
  PostgreSQLLogParser,
  PythonLogParser,
  CustomFormatParser,
  LogParserFactory,
} from '../utils/debug-log-parsers';
import { LogLevel, LogType } from '../utils/debug-log-analyzer';

describe('NginxLogParser', () => {
  const parser = new NginxLogParser();

  const sampleLog =
    '192.168.1.1 - admin [01/Jan/2026:10:30:00 +0000] "GET /api/users HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0"';

  test('Nginx combinedフォーマットをパースできること', () => {
    expect(parser.canParse(sampleLog)).toBe(true);
    const result = parser.parse(sampleLog);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('192.168.1.1');
    expect(result!.message).toBe('GET /api/users HTTP/1.1');
    expect(result!.metadata!.statusCode).toBe(200);
    expect(result!.metadata!.size).toBe(1234);
    expect(result!.metadata!.userAgent).toBe('Mozilla/5.0');
    expect(result!.type).toBe(LogType.NGINX);
  });

  test('user=-の場合undefinedになること', () => {
    const log = '10.0.0.1 - - [01/Jan/2026:10:30:00 +0000] "GET / HTTP/1.1" 200 100 "-" "curl"';
    const result = parser.parse(log);
    expect(result!.metadata!.user).toBeUndefined();
    expect(result!.metadata!.referer).toBeUndefined();
  });

  test('ステータスコード500以上でERRORレベルになること', () => {
    const log = '10.0.0.1 - - [01/Jan/2026:10:30:00 +0000] "GET / HTTP/1.1" 500 100 "-" "curl"';
    const result = parser.parse(log);
    expect(result!.level).toBe(LogLevel.ERROR);
  });

  test('ステータスコード400台でWARNレベルになること', () => {
    const log = '10.0.0.1 - - [01/Jan/2026:10:30:00 +0000] "GET / HTTP/1.1" 404 100 "-" "curl"';
    const result = parser.parse(log);
    expect(result!.level).toBe(LogLevel.WARN);
  });

  test('ステータスコード200台でINFOレベルになること', () => {
    const log = '10.0.0.1 - - [01/Jan/2026:10:30:00 +0000] "GET / HTTP/1.1" 200 100 "-" "curl"';
    const result = parser.parse(log);
    expect(result!.level).toBe(LogLevel.INFO);
  });

  test('不正なフォーマットでnullを返すこと', () => {
    expect(parser.parse('invalid log line')).toBeNull();
  });
});

describe('ApacheCombinedLogParser', () => {
  const parser = new ApacheCombinedLogParser();

  const sampleLog =
    '192.168.1.1 - admin [15/Mar/2026:14:20:00 +0900] "POST /api/data HTTP/1.1" 201 5678 "https://example.com/form" "Mozilla/5.0"';

  test('Apache Combinedフォーマットをパースできること', () => {
    expect(parser.canParse(sampleLog)).toBe(true);
    const result = parser.parse(sampleLog);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('192.168.1.1');
    expect(result!.metadata!.statusCode).toBe(201);
    expect(result!.metadata!.referer).toBe('https://example.com/form');
    expect(result!.type).toBe(LogType.APACHE_COMBINED);
  });

  test('size=-の場合0になること', () => {
    const log = '10.0.0.1 - - [01/Jan/2026:10:30:00 +0000] "HEAD / HTTP/1.1" 304 - "-" "curl"';
    const result = parser.parse(log);
    expect(result!.metadata!.size).toBe(0);
  });
});

describe('WindowsEventLogParser', () => {
  const parser = new WindowsEventLogParser();

  test('CSVフォーマットをパースできること', () => {
    const log = '"Error","2026-01-01 10:00:00","Application","1234","None","An error occurred"';
    expect(parser.canParse(log)).toBe(true);
    const result = parser.parse(log);
    expect(result).not.toBeNull();
    expect(result!.level).toBe(LogLevel.ERROR);
    expect(result!.message).toBe('An error occurred');
    expect(result!.source).toBe('Application');
  });

  test('Event[]フォーマットをパースできること', () => {
    const log = 'Event[SystemLog]: Service stopped unexpectedly';
    expect(parser.canParse(log)).toBe(true);
    const result = parser.parse(log);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('SystemLog');
    expect(result!.message).toBe('Service stopped unexpectedly');
  });

  test('mapEventLevelが正しくマッピングすること', () => {
    const info = '"Information","2026-01-01 10:00:00","App","1","None","Info msg"';
    const warn = '"Warning","2026-01-01 10:00:00","App","1","None","Warn msg"';
    const critical = '"Critical","2026-01-01 10:00:00","App","1","None","Critical msg"';

    expect(parser.parse(info)!.level).toBe(LogLevel.INFO);
    expect(parser.parse(warn)!.level).toBe(LogLevel.WARN);
    expect(parser.parse(critical)!.level).toBe(LogLevel.FATAL);
  });

  test('メッセージからレベルを検出すること', () => {
    const errorLog = 'Event[App]: Operation failed with error';
    const warnLog = 'Event[App]: Warning: low disk space';
    const infoLog = 'Event[App]: Service started successfully';

    expect(parser.parse(errorLog)!.level).toBe(LogLevel.ERROR);
    expect(parser.parse(warnLog)!.level).toBe(LogLevel.WARN);
    expect(parser.parse(infoLog)!.level).toBe(LogLevel.INFO);
  });
});

describe('DockerLogParser', () => {
  const parser = new DockerLogParser();

  test('Docker JSONログをパースできること', () => {
    const log = JSON.stringify({
      log: 'Application started\n',
      stream: 'stdout',
      time: '2026-01-01T10:00:00.000Z',
    });
    // canParseはisDockerJsonLogまたは"docker"を含むかチェック
    // Docker JSON形式はlog, stream, timeを持つ
    expect(parser.canParse(log)).toBeTruthy();
    const result = parser.parse(log);
    expect(result).not.toBeNull();
    expect(result!.message).toBe('Application started');
    expect(result!.level).toBe(LogLevel.INFO);
    expect(result!.source).toBe('docker');
  });

  test('stderrストリームでERRORレベルになること', () => {
    const log = JSON.stringify({
      log: 'Error occurred\n',
      stream: 'stderr',
      time: '2026-01-01T10:00:00.000Z',
    });
    const result = parser.parse(log);
    expect(result!.level).toBe(LogLevel.ERROR);
  });

  test('Docker compose形式をパースできること', () => {
    const log = 'web-app | Server listening on port 3000';
    const result = parser.parse(log);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('web-app');
    expect(result!.message).toBe('Server listening on port 3000');
  });

  test('compose形式でメッセージからレベル検出すること', () => {
    const errorLog = 'web-app | Error: connection refused';
    const warnLog = 'web-app | Warning: deprecated API used';
    const debugLog = 'web-app | debug: query executed';

    expect(parser.parse(errorLog)!.level).toBe(LogLevel.ERROR);
    expect(parser.parse(warnLog)!.level).toBe(LogLevel.WARN);
    expect(parser.parse(debugLog)!.level).toBe(LogLevel.DEBUG);
  });
});

describe('PostgreSQLLogParser', () => {
  const parser = new PostgreSQLLogParser();

  test('PostgreSQLログをパースできること', () => {
    const log = '2026-01-01 10:00:00.123 UTC [12345] LOG:  database system is ready';
    const result = parser.parse(log);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('postgres[12345]');
    expect(result!.message).toBe('database system is ready');
    expect(result!.metadata!.pid).toBe(12345);
  });

  test('DEBUGレベルをマッピングすること', () => {
    const log = '2026-01-01 10:00:00.123 UTC [100] DEBUG:  query plan generated';
    const result = parser.parse(log);
    expect(result!.level).toBe(LogLevel.DEBUG);
  });

  test('ERRORレベルをマッピングすること', () => {
    const log = '2026-01-01 10:00:00.123 UTC [100] ERROR:  relation does not exist';
    const result = parser.parse(log);
    expect(result!.level).toBe(LogLevel.ERROR);
  });

  test('FATALレベルをマッピングすること', () => {
    const log = '2026-01-01 10:00:00.123 UTC [100] FATAL:  could not open file';
    const result = parser.parse(log);
    expect(result!.level).toBe(LogLevel.FATAL);
  });

  test('WARNINGレベルをマッピングすること', () => {
    const log = '2026-01-01 10:00:00.123 UTC [100] WARNING:  table has no primary key';
    const result = parser.parse(log);
    expect(result!.level).toBe(LogLevel.WARN);
  });
});

describe('PythonLogParser', () => {
  const parser = new PythonLogParser();

  test('Python loggingフォーマットをパースできること', () => {
    const log = '2026-01-01 10:00:00,123 - myapp.module - INFO - Request processed';
    expect(parser.canParse(log)).toBe(true);
    const result = parser.parse(log);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('myapp.module');
    expect(result!.message).toBe('Request processed');
    expect(result!.level).toBe(LogLevel.INFO);
    expect(result!.metadata!.logger).toBe('myapp.module');
  });

  test('CRITICALレベルをFATALにマッピングすること', () => {
    const log = '2026-01-01 10:00:00,000 - root - CRITICAL - System shutdown';
    const result = parser.parse(log);
    expect(result!.level).toBe(LogLevel.FATAL);
  });

  test('WARNINGレベルをWARNにマッピングすること', () => {
    const log = '2026-01-01 10:00:00,000 - app - WARNING - Deprecated function';
    const result = parser.parse(log);
    expect(result!.level).toBe(LogLevel.WARN);
  });
});

describe('CustomFormatParser', () => {
  test('ユーザー定義正規表現でパースできること', () => {
    const parser = new CustomFormatParser(/^(\S+)\s+\[(\w+)\]\s+(.*)$/, {
      groups: ['timestamp', 'level', 'message'],
    });

    const log = '2026-01-01T10:00:00Z [ERROR] Something went wrong';
    expect(parser.canParse(log)).toBe(true);
    const result = parser.parse(log);
    expect(result).not.toBeNull();
    expect(result!.level).toBe(LogLevel.ERROR);
    expect(result!.message).toBe('Something went wrong');
  });

  test('未知のフィールドはmetadataに格納されること', () => {
    const parser = new CustomFormatParser(/^(\S+)\s+(\S+)\s+(.*)$/, {
      groups: ['timestamp', 'requestId', 'message'],
    });

    const log = '2026-01-01 req-123 Hello world';
    const result = parser.parse(log);
    expect(result!.metadata!.requestId).toBe('req-123');
    expect(result!.message).toBe('Hello world');
  });

  test('マッチしない場合nullを返すこと', () => {
    const parser = new CustomFormatParser(/^SPECIFIC:(.*)$/, {
      groups: ['message'],
    });
    expect(parser.parse('no match here')).toBeNull();
  });
});

describe('LogParserFactory', () => {
  test('createAllParsersが6個のパーサーを返すこと', () => {
    const parsers = LogParserFactory.createAllParsers();
    expect(parsers).toHaveLength(6);
  });

  test('createCustomParserが文字列パターンからパーサーを作成すること', () => {
    const parser = LogParserFactory.createCustomParser('^(\\S+)\\s+(.*)$', {
      groups: ['level', 'message'],
    });
    expect(parser).toBeInstanceOf(CustomFormatParser);
    const result = parser.parse('ERROR something happened');
    expect(result).not.toBeNull();
    expect(result!.level).toBe(LogLevel.ERROR);
  });

  test('createCustomParserがRegExpからパーサーを作成すること', () => {
    const parser = LogParserFactory.createCustomParser(/^(\S+)\s+(.*)$/, {
      groups: ['level', 'message'],
    });
    const result = parser.parse('INFO all good');
    expect(result!.level).toBe(LogLevel.INFO);
  });
});
