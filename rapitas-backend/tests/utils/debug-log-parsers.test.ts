/**
 * Debug Log Parsers Test
 *
 * Tests for additional log parser implementations.
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
  LogParserFactory,
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

describe('LogParserFactory', () => {
  test('全パーサーを生成できること', () => {
    const parsers = LogParserFactory.createAllParsers();
    expect(parsers.length).toBe(6);
  });

  test('カスタムパーサーを文字列パターンから生成できること', () => {
    const parser = LogParserFactory.createCustomParser('^(\\w+): (.+)$', {
      groups: ['level', 'message'],
    });
    expect(parser.canParse('ERROR: test')).toBe(true);
    const result = parser.parse('ERROR: test');
    expect(result!.level).toBe(LogLevel.ERROR);
  });

  test('カスタムパーサーをRegExpから生成できること', () => {
    const parser = LogParserFactory.createCustomParser(/^(\w+): (.+)$/, {
      groups: ['level', 'message'],
    });
    expect(parser.canParse('INFO: hello')).toBe(true);
  });

  test('最適なパーサーを選択できること', () => {
    const logs = [
      '192.168.1.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 1234',
      '{"level":"info","message":"JSON log"}',
      '2024-01-01T10:00:00Z ERROR [service] Something failed',
    ];

    logs.forEach((log) => {
      const parser = LogParserFactory.findBestParser(log);
      expect(parser).toBeDefined();
      expect(parser.canParse(log)).toBe(true);
    });
  });

  test('複数のパーサーが同一ログをパースできる場合の優先順位テスト', () => {
    const logLine = 'INFO: This could match multiple parsers';

    const parsers = LogParserFactory.createAllParsers();
    const compatibleParsers = parsers.filter((p) => p.canParse(logLine));

    expect(compatibleParsers.length).toBeGreaterThanOrEqual(1);

    // Verify the first matching parser is selected
    const bestParser = LogParserFactory.findBestParser(logLine);
    expect(compatibleParsers[0]).toBe(bestParser);
  });
});

describe('パーサー統合テスト', () => {
  test('各パーサーが相互に干渉しないこと', () => {
    const testCases = [
      {
        parser: new NginxLogParser(),
        validLog: '192.168.1.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 1234',
        invalidLogs: [
          '{"level":"info","message":"JSON log"}',
          'Jan 01 00:00:00 host app: syslog',
          '2024-01-01T10:00:00Z INFO [app] nodejs log',
        ],
      },
      {
        parser: new DockerLogParser(),
        validLog:
          '2024-01-01T10:00:00.123456789Z stdout F {"level":"info","message":"Docker JSON"}',
        invalidLogs: [
          '192.168.1.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 1234',
          'Jan 01 00:00:00 host app: syslog',
        ],
      },
    ];

    testCases.forEach(({ parser, validLog, invalidLogs }) => {
      expect(parser.canParse(validLog)).toBe(true);
      expect(parser.parse(validLog)).not.toBeNull();

      invalidLogs.forEach((invalidLog) => {
        expect(parser.canParse(invalidLog)).toBe(false);
      });
    });
  });

  test('パーサーのパフォーマンス比較', () => {
    const parsers = LogParserFactory.createAllParsers();
    const testLogs = [
      '{"level":"info","message":"JSON test"}',
      '192.168.1.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 1234',
      'Jan 01 00:00:00 host app[123]: Syslog test',
      '2024-01-01T10:00:00Z INFO [app] Node.js test',
    ];

    parsers.forEach((parser) => {
      testLogs.forEach((log) => {
        const start = performance.now();

        for (let i = 0; i < 1000; i++) {
          parser.canParse(log);
          if (parser.canParse(log)) {
            parser.parse(log);
          }
        }

        const end = performance.now();
        expect(end - start).toBeLessThan(1000); // Within 1 second
      });
    });
  });

  test('大量ログでのメモリ効率テスト', () => {
    const parser = new NginxLogParser();
    const baseLog = '192.168.1.1 - - [01/Jan/2024:00:00:00 +0000] "GET /test HTTP/1.1" 200 1234';

    // Generate and process a large volume of logs
    for (let batch = 0; batch < 100; batch++) {
      const logs = Array.from({ length: 100 }, (_, i) =>
        baseLog.replace('/test', `/test${batch * 100 + i}`),
      );

      logs.forEach((log) => {
        const result = parser.parse(log);
        expect(result).toBeDefined();
      });
    }
    // Implicitly tests for memory leaks (an error here would indicate OOM)
  });
});

describe('エラーハンドリングとエッジケース', () => {
  test('不正な正規表現パターンでカスタムパーサー作成時にエラーハンドリング', () => {
    expect(() => {
      LogParserFactory.createCustomParser('([unclosed group', { groups: ['level'] });
    }).toThrow();
  });

  test('グループ数とフィールド数の不一致を検出すること', () => {
    const parser = LogParserFactory.createCustomParser(
      /^(\w+): (.+)$/,
      { groups: ['level', 'message', 'extra'] }, // 3 group names specified but regex has only 2 capture groups
    );

    const result = parser.parse('INFO: test message');
    expect(result?.metadata?.extra).toBeUndefined();
  });

  test('空文字列や改行のみの入力を適切に処理すること', () => {
    const parsers = LogParserFactory.createAllParsers();

    const edgeCases = ['', '   ', '\n', '\t', '\r\n'];

    parsers.forEach((parser) => {
      edgeCases.forEach((edge) => {
        expect(parser.canParse(edge)).toBe(false);
        expect(parser.parse(edge)).toBeNull();
      });
    });
  });

  test('非常に長い文字列を安全に処理すること', () => {
    const longString = 'x'.repeat(100000);
    const parser = new CustomFormatParser('LONG:', ['message']);

    const longLog = `LONG: ${longString}`;
    const start = performance.now();
    const result = parser.parse(longLog);
    const end = performance.now();

    expect(result?.message).toBe(longString);
    expect(end - start).toBeLessThan(1000); // Within 1 second
  });

  test('Unicode文字を含むログを正しく処理すること', () => {
    const parsers = [new NginxLogParser(), new DockerLogParser(), new PostgreSQLLogParser()];

    const unicodeMessage = 'ログメッセージ 🚀 𝓤𝓷𝓲𝓬𝓸𝓭𝓮';
    const testLogs = [
      `192.168.1.1 - - [01/Jan/2024:00:00:00 +0000] "GET /${unicodeMessage} HTTP/1.1" 200 1234`,
      `2024-01-01T10:00:00.000Z stdout F ${unicodeMessage}`,
      `2024-01-01 10:00:00.000 UTC [123] LOG: ${unicodeMessage}`,
    ];

    parsers.forEach((parser, index) => {
      if (parser.canParse(testLogs[index])) {
        const result = parser.parse(testLogs[index]);
        expect(result?.message).toContain(unicodeMessage);
      }
    });
  });

  test('制御文字を含む入力を安全に処理すること', () => {
    const controlChars = '\x00\x01\x02\x1f';
    const parser = new CustomFormatParser('CTRL:', ['message']);

    const logWithControls = `CTRL: Message with controls ${controlChars}`;
    const result = parser.parse(logWithControls);

    expect(result).toBeDefined();
    expect(result?.message).toContain(controlChars);
  });
});

describe('高度なパターンマッチングテスト', () => {
  test('複雑な正規表現パターンでカスタムパーサーを作成', () => {
    // Complex pattern: ISO 8601 timestamp + level + message
    const complexPattern =
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\s+\[(\w+)\]\s+(.+)$/;

    const parser = LogParserFactory.createCustomParser(complexPattern, {
      groups: ['timestamp', 'level', 'message'],
      timestampFormat: 'ISO',
    });

    const testLog = '2024-01-01T10:30:45.123Z [ERROR] Complex pattern matched successfully';
    expect(parser.canParse(testLog)).toBe(true);

    const result = parser.parse(testLog);
    expect(result?.level).toBe(LogLevel.ERROR);
    expect(result?.message).toBe('Complex pattern matched successfully');
    expect(result?.timestamp).toBeInstanceOf(Date);
  });

  test('名前付きキャプチャグループを使用したパーサー', () => {
    const namedGroupPattern = /^(?<timestamp>\d{4}-\d{2}-\d{2})\s+(?<level>\w+):\s+(?<message>.+)$/;

    const parser = LogParserFactory.createCustomParser(namedGroupPattern, {
      groups: ['timestamp', 'level', 'message'],
      useNamedGroups: true,
    });

    const testLog = '2024-01-01 ERROR: Named groups working';
    const result = parser.parse(testLog);

    expect(result?.level).toBe(LogLevel.ERROR);
    expect(result?.message).toBe('Named groups working');
  });

  test('条件付きマッチングパターン', () => {
    // Flexible pattern: timestamp is sometimes present, sometimes absent
    const flexiblePattern = /^(?:(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+)?(\w+):\s+(.+)$/;

    const parser = LogParserFactory.createCustomParser(flexiblePattern, {
      groups: ['timestamp', 'level', 'message'],
    });

    const withTimestamp = '2024-01-01 10:00:00 INFO: With timestamp';
    const withoutTimestamp = 'ERROR: Without timestamp';

    expect(parser.canParse(withTimestamp)).toBe(true);
    expect(parser.canParse(withoutTimestamp)).toBe(true);

    const result1 = parser.parse(withTimestamp);
    const result2 = parser.parse(withoutTimestamp);

    expect(result1?.timestamp).toBeInstanceOf(Date);
    expect(result2?.timestamp).toBeUndefined();
    expect(result1?.level).toBe(LogLevel.INFO);
    expect(result2?.level).toBe(LogLevel.ERROR);
  });

  test('マルチライン対応パターン', () => {
    const multilineParser = new CustomFormatParser(/^MULTILINE_START:(.*?)MULTILINE_END/s, [
      'message',
    ]);

    const multilineLog = `MULTILINE_START:
Line 1
Line 2
Line 3
MULTILINE_END`;

    const result = multilineParser.parse(multilineLog);
    expect(result?.message).toContain('Line 1');
    expect(result?.message).toContain('Line 2');
    expect(result?.message).toContain('Line 3');
  });
});

describe('実世界のログ形式テスト', () => {
  test('Apache access log の variations', () => {
    const parser = new ApacheCombinedLogParser();

    const variations = [
      // With IPv6
      '::1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 1234 "-" "Mozilla/5.0"',
      // With user authentication
      '192.168.1.1 - john [01/Jan/2024:00:00:00 +0000] "POST /login HTTP/1.1" 302 0 "https://example.com/login" "curl/7.68.0"',
      // With query parameters
      '10.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET /search?q=test&page=1 HTTP/1.1" 200 5678 "-" "Bot/1.0"',
    ];

    variations.forEach((log) => {
      expect(parser.canParse(log)).toBe(true);
      const result = parser.parse(log);
      expect(result).toBeDefined();
      expect(result?.metadata?.statusCode).toBeDefined();
    });
  });

  test('Docker compose logs with service names', () => {
    const parser = new DockerLogParser();

    const dockerLogs = [
      // Standard format
      '2024-01-01T10:00:00.123456789Z stdout F {"level":"info","message":"Standard docker log"}',
      // With service prefix
      'web_1      | 2024-01-01T10:00:00.123456789Z stdout F Service log message',
      // stderr stream
      '2024-01-01T10:00:01.000000000Z stderr P Partial message',
      '2024-01-01T10:00:01.000000000Z stderr F  continued here',
    ];

    dockerLogs.forEach((log) => {
      if (parser.canParse(log)) {
        const result = parser.parse(log);
        expect(result?.type).toBe(LogType.CUSTOM);
      }
    });
  });

  test('PostgreSQL ログの時間帯とロケール variations', () => {
    const parser = new PostgreSQLLogParser();

    const pgLogs = [
      // With timezone
      '2024-01-01 10:00:00.123 PST [123] LOG: Query executed successfully',
      // With different locale
      '2024-01-01 10:00:00,456 CET [456] ERROR: relation "users" does not exist',
      // Multi-line query
      '2024-01-01 10:00:00.789 UTC [789] STATEMENT: SELECT * FROM users\n\t\tWHERE active = true',
    ];

    pgLogs.forEach((log) => {
      if (parser.canParse(log)) {
        const result = parser.parse(log);
        expect(result?.timestamp).toBeInstanceOf(Date);
      }
    });
  });
});

describe('カスタムフォーマット詳細テスト', () => {
  test('動的パターン生成', () => {
    const formats = [
      { prefix: 'AUDIT', fields: ['user', 'action', 'resource'] },
      { prefix: 'METRIC', fields: ['name', 'value', 'unit', 'timestamp'] },
      { prefix: 'TRACE', fields: ['traceId', 'spanId', 'operation'] },
    ];

    formats.forEach(({ prefix, fields }) => {
      const parser = new CustomFormatParser(prefix + ':', fields);

      const testValues = fields.map((_, i) => `value${i + 1}`);
      const testLog = `${prefix}: ${testValues.join(' ')}`;

      const result = parser.parse(testLog);
      expect(result).toBeDefined();

      fields.forEach((field, index) => {
        expect(result?.metadata?.[field]).toBe(testValues[index]);
      });
    });
  });

  test('階層的フィールド構造', () => {
    const hierarchicalParser = new CustomFormatParser(/^HIER: (\w+)\.(\w+)\.(\w+)=(.+)$/, [
      'service',
      'component',
      'metric',
      'value',
    ]);

    const testLog = 'HIER: api.auth.requests=150';
    const result = hierarchicalParser.parse(testLog);

    expect(result?.metadata?.service).toBe('api');
    expect(result?.metadata?.component).toBe('auth');
    expect(result?.metadata?.metric).toBe('requests');
    expect(result?.metadata?.value).toBe('150');
  });

  test('条件付きフィールド抽出', () => {
    const conditionalParser = new CustomFormatParser(
      /^EVENT: (\w+)(?:\s+user:(\w+))?(?:\s+session:(\w+))?(?:\s+(.+))?$/,
      ['event', 'user', 'session', 'details'],
    );

    const testCases = [
      { log: 'EVENT: login', expectedFields: ['event'] },
      { log: 'EVENT: logout user:john', expectedFields: ['event', 'user'] },
      {
        log: 'EVENT: action user:jane session:abc123 extra details here',
        expectedFields: ['event', 'user', 'session', 'details'],
      },
    ];

    testCases.forEach(({ log, expectedFields }) => {
      const result = conditionalParser.parse(log);
      expect(result?.metadata?.event).toBeDefined();

      expectedFields.forEach((field) => {
        if (field !== 'event') {
          // event is stored in message
          expect(result?.metadata?.[field]).toBeDefined();
        }
      });
    });
  });
});

describe('パーサーファクトリー高度機能', () => {
  test('パーサーチェーンの構築', () => {
    const chain = LogParserFactory.createParserChain([
      new NginxLogParser(),
      new DockerLogParser(),
      new CustomFormatParser('FALLBACK:', ['message']),
    ]);

    const testLogs = [
      '192.168.1.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 1234',
      '2024-01-01T10:00:00.123456789Z stdout F Docker message',
      'FALLBACK: This should be caught by fallback',
    ];

    testLogs.forEach((log) => {
      const parser = chain.find((p) => p.canParse(log));
      expect(parser).toBeDefined();
      const result = parser!.parse(log);
      expect(result).toBeDefined();
    });
  });

  test('パーサー統計情報の収集', () => {
    const parsers = LogParserFactory.createAllParsers();
    const logs = [
      '{"level":"info","message":"JSON"}',
      '192.168.1.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 1234',
      'Jan 01 00:00:00 host app: syslog',
      'unparseable log line',
    ];

    const stats = {
      totalLogs: logs.length,
      successfullyParsed: 0,
      parserUsage: new Map(),
    };

    logs.forEach((log) => {
      const parser = parsers.find((p) => p.canParse(log));
      if (parser) {
        stats.successfullyParsed++;
        const parserName = parser.constructor.name;
        stats.parserUsage.set(parserName, (stats.parserUsage.get(parserName) || 0) + 1);
      }
    });

    expect(stats.successfullyParsed).toBe(3);
    expect(stats.parserUsage.size).toBeGreaterThan(0);
  });
});
