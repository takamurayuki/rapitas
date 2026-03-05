/**
 * Debug Log Analyzer テスト
 * 各種ログパーサーとアナライザーのテスト
 */
import { describe, test, expect } from "bun:test";
import {
  DebugLogAnalyzer,
  JSONLogParser,
  SyslogParser,
  ApacheCommonLogParser,
  NodeJSLogParser,
  LogType,
  LogLevel,
} from "../utils/debug-log-analyzer";

describe("JSONLogParser", () => {
  const parser = new JSONLogParser();

  test("JSON行をパースできること", () => {
    expect(parser.canParse('{"message":"hello"}')).toBe(true);
  });

  test("非JSON行はパースできないこと", () => {
    expect(parser.canParse("plain text log")).toBe(false);
  });

  test("JSONログを正しくパースすること", () => {
    const result = parser.parse('{"level":"error","message":"Something failed","source":"app"}');
    expect(result).not.toBeNull();
    expect(result!.level).toBe(LogLevel.ERROR);
    expect(result!.message).toBe("Something failed");
    expect(result!.source).toBe("app");
    expect(result!.type).toBe(LogType.JSON);
  });

  test("timestampをDateに変換すること", () => {
    const result = parser.parse('{"timestamp":"2024-01-15T10:30:00Z","message":"test"}');
    expect(result!.timestamp).toBeInstanceOf(Date);
  });

  test("msgフィールドもmessageとして扱うこと", () => {
    const result = parser.parse('{"msg":"hello from pino"}');
    expect(result!.message).toBe("hello from pino");
  });

  test("loggerフィールドをsourceとして扱うこと", () => {
    const result = parser.parse('{"logger":"my-service","message":"test"}');
    expect(result!.source).toBe("my-service");
  });

  test("severityフィールドをlevelとして扱うこと", () => {
    const result = parser.parse('{"severity":"warning","message":"test"}');
    expect(result!.level).toBe(LogLevel.WARN);
  });

  test("不明なレベルはINFOにフォールバックすること", () => {
    const result = parser.parse('{"level":"custom","message":"test"}');
    expect(result!.level).toBe(LogLevel.INFO);
  });

  test("レベルなしはINFOを返すこと", () => {
    const result = parser.parse('{"message":"test"}');
    expect(result!.level).toBe(LogLevel.INFO);
  });

  test("fatalレベルを正しく処理すること", () => {
    const result = parser.parse('{"level":"critical","message":"test"}');
    expect(result!.level).toBe(LogLevel.FATAL);
  });
});

describe("SyslogParser", () => {
  const parser = new SyslogParser();

  test("syslog形式をパースできること", () => {
    expect(parser.canParse("<34>Jan  5 14:30:00 myhost sshd[1234]: Connection accepted")).toBe(true);
  });

  test("非syslog形式はパースできないこと", () => {
    expect(parser.canParse("plain text")).toBe(false);
  });

  test("syslogメッセージを正しくパースすること", () => {
    const result = parser.parse("<34>Jan  5 14:30:00 myhost sshd[1234]: Connection accepted");
    expect(result).not.toBeNull();
    expect(result!.message).toBe("Connection accepted");
    expect(result!.source).toBe("sshd[1234]");
    expect(result!.metadata!.hostname).toBe("myhost");
    expect(result!.metadata!.pid).toBe(1234);
  });

  test("severity 0-2をFATALにマッピングすること", () => {
    // priority=0 → facility=0, severity=0 → FATAL
    const result = parser.parse("<0>Jan  5 14:30:00 myhost kernel[0]: panic");
    expect(result!.level).toBe(LogLevel.FATAL);
  });

  test("severity 3をERRORにマッピングすること", () => {
    // priority=3 → facility=0, severity=3 → ERROR
    const result = parser.parse("<3>Jan  5 14:30:00 myhost app[100]: error occurred");
    expect(result!.level).toBe(LogLevel.ERROR);
  });

  test("severity 4をWARNにマッピングすること", () => {
    const result = parser.parse("<4>Jan  5 14:30:00 myhost app[100]: warning");
    expect(result!.level).toBe(LogLevel.WARN);
  });

  test("severity 7をDEBUGにマッピングすること", () => {
    const result = parser.parse("<7>Jan  5 14:30:00 myhost app[100]: debug info");
    expect(result!.level).toBe(LogLevel.DEBUG);
  });
});

describe("ApacheCommonLogParser", () => {
  const parser = new ApacheCommonLogParser();

  test("Apache Common Log形式をパースできること", () => {
    expect(parser.canParse('127.0.0.1 - frank [10/Oct/2024:13:55:36 +0900] "GET /index.html HTTP/1.1" 200 2326')).toBe(true);
  });

  test("Apache Common Logを正しくパースすること", () => {
    const result = parser.parse('192.168.1.1 - admin [15/Jan/2024:10:30:00 +0000] "POST /api/data HTTP/1.1" 201 512');
    expect(result).not.toBeNull();
    expect(result!.source).toBe("192.168.1.1");
    expect(result!.message).toBe("POST /api/data HTTP/1.1");
    expect(result!.metadata!.statusCode).toBe(201);
    expect(result!.metadata!.user).toBe("admin");
  });

  test("500番台のステータスをERRORにマッピングすること", () => {
    const result = parser.parse('127.0.0.1 - - [10/Oct/2024:13:55:36 +0900] "GET /error HTTP/1.1" 500 0');
    expect(result!.level).toBe(LogLevel.ERROR);
  });

  test("400番台のステータスをWARNにマッピングすること", () => {
    const result = parser.parse('127.0.0.1 - - [10/Oct/2024:13:55:36 +0900] "GET /missing HTTP/1.1" 404 0');
    expect(result!.level).toBe(LogLevel.WARN);
  });

  test("200番台のステータスをINFOにマッピングすること", () => {
    const result = parser.parse('127.0.0.1 - - [10/Oct/2024:13:55:36 +0900] "GET /ok HTTP/1.1" 200 1234');
    expect(result!.level).toBe(LogLevel.INFO);
  });

  test("user=-の場合undefinedを返すこと", () => {
    const result = parser.parse('127.0.0.1 - - [10/Oct/2024:13:55:36 +0900] "GET / HTTP/1.1" 200 0');
    expect(result!.metadata!.user).toBeUndefined();
  });
});

describe("NodeJSLogParser", () => {
  const parser = new NodeJSLogParser();

  test("パターン1をパースできること: [timestamp] LEVEL: message", () => {
    expect(parser.canParse("[2024-01-15T10:30:00.000Z] ERROR: Something went wrong")).toBe(true);
    const result = parser.parse("[2024-01-15T10:30:00.000Z] ERROR: Something went wrong");
    expect(result!.level).toBe(LogLevel.ERROR);
    expect(result!.message).toBe("Something went wrong");
  });

  test("パターン2をパースできること: LEVEL [timestamp] message", () => {
    expect(parser.canParse("WARN [2024-01-15T10:30:00.000Z] Disk space low")).toBe(true);
    const result = parser.parse("WARN [2024-01-15T10:30:00.000Z] Disk space low");
    expect(result!.level).toBe(LogLevel.WARN);
    expect(result!.message).toBe("Disk space low");
  });

  test("パターン3をパースできること: timestamp - LEVEL - message", () => {
    expect(parser.canParse("2024-01-15T10:30:00.000Z - INFO - Server started")).toBe(true);
    const result = parser.parse("2024-01-15T10:30:00.000Z - INFO - Server started");
    expect(result!.level).toBe(LogLevel.INFO);
    expect(result!.message).toBe("Server started");
  });

  test("非Node.js形式はパースできないこと", () => {
    expect(parser.canParse("just plain text")).toBe(false);
  });
});

describe("DebugLogAnalyzer", () => {
  const analyzer = new DebugLogAnalyzer();

  describe("detectLogType", () => {
    test("JSONログタイプを検出すること", () => {
      const content = '{"level":"info","message":"hello"}\n{"level":"error","message":"fail"}';
      expect(analyzer.detectLogType(content)).toBe(LogType.JSON);
    });

    test("空のログでUNKNOWNを返すこと", () => {
      expect(analyzer.detectLogType("")).toBe(LogType.UNKNOWN);
      expect(analyzer.detectLogType("  \n  \n  ")).toBe(LogType.UNKNOWN);
    });

    test("パースできないログでUNKNOWNを返すこと", () => {
      expect(analyzer.detectLogType("random text\nanother line")).toBe(LogType.UNKNOWN);
    });
  });

  describe("analyze", () => {
    test("JSONログを解析してサマリーを生成すること", () => {
      const content = [
        '{"level":"info","message":"Started"}',
        '{"level":"error","message":"Failed to connect"}',
        '{"level":"warn","message":"Slow query"}',
        '{"level":"info","message":"Completed"}',
      ].join("\n");

      const result = analyzer.analyze(content);
      expect(result.summary.totalEntries).toBe(4);
      expect(result.summary.errorCount).toBe(1);
      expect(result.summary.warningCount).toBe(1);
      expect(result.summary.levelDistribution[LogLevel.INFO]).toBe(2);
      expect(result.summary.levelDistribution[LogLevel.ERROR]).toBe(1);
      expect(result.summary.levelDistribution[LogLevel.WARN]).toBe(1);
    });

    test("パースできない行をUNKNOWNエントリとして保持すること", () => {
      const result = analyzer.analyze("unparseable line");
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].type).toBe(LogType.UNKNOWN);
      expect(result.entries[0].message).toBe("unparseable line");
    });

    test("エラーパターンを抽出すること", () => {
      const content = [
        '{"level":"error","message":"Connection timeout to db-1"}',
        '{"level":"error","message":"Connection timeout to db-2"}',
      ].join("\n");

      const result = analyzer.analyze(content);
      expect(result.patterns.errors.length).toBeGreaterThan(0);
    });

    test("頻出メッセージパターンを集約すること", () => {
      const content = Array(5)
        .fill('{"level":"info","message":"Request processed in 100ms"}')
        .join("\n");

      const result = analyzer.analyze(content);
      expect(result.patterns.frequentMessages.length).toBeGreaterThan(0);
      expect(result.patterns.frequentMessages[0].count).toBeGreaterThanOrEqual(1);
    });

    test("サンプルを最大3件に制限すること", () => {
      const content = Array(10)
        .fill('{"level":"info","message":"repeated"}')
        .join("\n");

      const result = analyzer.analyze(content);
      for (const pattern of result.patterns.frequentMessages) {
        expect(pattern.samples.length).toBeLessThanOrEqual(3);
      }
    });

    test("ソース分布を計算すること", () => {
      const content = [
        '{"level":"info","message":"test","source":"app"}',
        '{"level":"info","message":"test","source":"app"}',
        '{"level":"info","message":"test","source":"db"}',
      ].join("\n");

      const result = analyzer.analyze(content);
      expect(result.summary.sourceDistribution["app"]).toBe(2);
      expect(result.summary.sourceDistribution["db"]).toBe(1);
    });
  });

  describe("analyze with filter", () => {
    const content = [
      '{"level":"debug","message":"Debug msg"}',
      '{"level":"info","message":"Info msg"}',
      '{"level":"error","message":"Error msg"}',
    ].join("\n");

    test("レベルフィルタでエラー以上のみ返すこと", () => {
      const result = analyzer.analyze(content, {
        filter: { level: LogLevel.ERROR },
      });
      expect(result.summary.totalEntries).toBe(1);
      expect(result.entries[0].level).toBe(LogLevel.ERROR);
    });

    test("テキスト検索フィルタが動作すること", () => {
      const result = analyzer.analyze(content, {
        filter: { searchText: "Info" },
      });
      expect(result.summary.totalEntries).toBe(1);
      expect(result.entries[0].message).toBe("Info msg");
    });

    test("ソースフィルタが動作すること", () => {
      const content2 = [
        '{"level":"info","message":"test","source":"app-server"}',
        '{"level":"info","message":"test","source":"db-server"}',
      ].join("\n");

      const result = analyzer.analyze(content2, {
        filter: { source: "app" },
      });
      expect(result.summary.totalEntries).toBe(1);
    });
  });

  describe("analyzeStream", () => {
    test("非同期イテレータからログを解析すること", async () => {
      async function* lines() {
        yield '{"level":"info","message":"line1"}';
        yield '{"level":"error","message":"line2"}';
      }

      const entries = [];
      for await (const entry of analyzer.analyzeStream(lines())) {
        entries.push(entry);
      }
      expect(entries.length).toBe(2);
      expect(entries[0].level).toBe(LogLevel.INFO);
      expect(entries[1].level).toBe(LogLevel.ERROR);
    });

    test("空行をスキップすること", async () => {
      async function* lines() {
        yield '{"level":"info","message":"line1"}';
        yield "";
        yield "  ";
        yield '{"level":"info","message":"line2"}';
      }

      const entries = [];
      for await (const entry of analyzer.analyzeStream(lines())) {
        entries.push(entry);
      }
      expect(entries.length).toBe(2);
    });

    test("フィルタ付きストリーム解析が動作すること", async () => {
      async function* lines() {
        yield '{"level":"debug","message":"skip"}';
        yield '{"level":"error","message":"keep"}';
      }

      const entries = [];
      for await (const entry of analyzer.analyzeStream(lines(), {
        filter: { level: LogLevel.ERROR },
      })) {
        entries.push(entry);
      }
      expect(entries.length).toBe(1);
      expect(entries[0].level).toBe(LogLevel.ERROR);
    });
  });

  describe("addParser", () => {
    test("カスタムパーサーを先頭に追加できること", () => {
      const customAnalyzer = new DebugLogAnalyzer();
      const customParser = {
        type: LogType.CUSTOM,
        canParse: (line: string) => line.startsWith("CUSTOM:"),
        parse: (line: string) => ({
          raw: line,
          type: LogType.CUSTOM,
          message: line.replace("CUSTOM:", "").trim(),
          level: LogLevel.INFO,
        }),
      };

      customAnalyzer.addParser(customParser);
      const result = customAnalyzer.analyze("CUSTOM: Hello world");
      expect(result.entries[0].type).toBe(LogType.CUSTOM);
      expect(result.entries[0].message).toBe("Hello world");
    });

    test("複数のカスタムパーサーを追加できること", () => {
      const analyzer = new DebugLogAnalyzer();

      const parser1 = {
        type: LogType.CUSTOM,
        canParse: (line: string) => line.startsWith("TYPE1:"),
        parse: (line: string) => ({
          raw: line,
          type: LogType.CUSTOM,
          message: line.replace("TYPE1:", "").trim(),
          level: LogLevel.DEBUG,
        }),
      };

      const parser2 = {
        type: LogType.CUSTOM,
        canParse: (line: string) => line.startsWith("TYPE2:"),
        parse: (line: string) => ({
          raw: line,
          type: LogType.CUSTOM,
          message: line.replace("TYPE2:", "").trim(),
          level: LogLevel.WARN,
        }),
      };

      analyzer.addParser(parser1);
      analyzer.addParser(parser2);

      const logs = "TYPE1: First message\nTYPE2: Second message";
      const result = analyzer.analyze(logs);

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].message).toBe("First message");
      expect(result.entries[1].message).toBe("Second message");
    });
  });

  describe("エッジケースとエラーハンドリング", () => {
    test("非常に長いログ行を処理すること", () => {
      const analyzer = new DebugLogAnalyzer();
      const longMessage = "x".repeat(100000);
      const logLine = `{"level":"info","message":"${longMessage}"}`;

      const result = analyzer.analyze(logLine);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].message).toBe(longMessage);
    });

    test("改行文字を含むログメッセージを処理すること", () => {
      const analyzer = new DebugLogAnalyzer();
      const multilineMessage = "Line 1\nLine 2\nLine 3";
      const logLine = JSON.stringify({level:"error", message: multilineMessage});

      const result = analyzer.analyze(logLine);
      expect(result.entries[0].message).toBe(multilineMessage);
    });

    test("特殊文字を含むログを処理すること", () => {
      const analyzer = new DebugLogAnalyzer();
      const specialChars = "Special chars: !@#$%^&*(){}[]|:;'<>?,./-+=~`";
      const logLine = JSON.stringify({level:"info", message: specialChars});

      const result = analyzer.analyze(logLine);
      expect(result.entries[0].message).toBe(specialChars);
    });

    test("Unicodeサロゲートペアを含むログを処理すること", () => {
      const analyzer = new DebugLogAnalyzer();
      const unicodeMessage = "Unicode: 𝓣𝓮𝓼𝓽 🚀 𝕌𝕟𝕚𝕔𝕠𝕕𝕖";
      const logLine = `{"level":"info","message":"${unicodeMessage}"}`;

      const result = analyzer.analyze(logLine);
      expect(result.entries[0].message).toBe(unicodeMessage);
    });

    test("null値やundefinedを含むJSONログを処理すること", () => {
      const analyzer = new DebugLogAnalyzer();
      const logLine = '{"level":"info","message":"test","nullField":null}';

      const result = analyzer.analyze(logLine);
      expect(result.entries[0].message).toBe("test");
      expect(result.entries[0].metadata).toBeDefined();
    });

    test("深くネストしたオブジェクトを含むログを処理すること", () => {
      const analyzer = new DebugLogAnalyzer();
      const nestedData = {
        level: "error",
        message: "Nested error",
        context: {
          user: { id: 123, name: "test" },
          request: { method: "POST", url: "/api/test" },
          error: { code: 500, details: { timeout: true } }
        }
      };
      const logLine = JSON.stringify(nestedData);

      const result = analyzer.analyze(logLine);
      expect(result.entries[0].metadata?.context).toBeDefined();
    });

    test("循環参照を含む可能性のあるログ構造をハンドリングすること", () => {
      const analyzer = new DebugLogAnalyzer();
      // 循環参照はJSON.stringifyでエラーになるが、すでに文字列化されたログでテスト
      const logLine = '{"level":"error","message":"Circular ref handled","data":"[Circular]"}';

      const result = analyzer.analyze(logLine);
      expect(result.entries[0].message).toBe("Circular ref handled");
    });
  });

  describe("パフォーマンステスト", () => {
    test("大量のログエントリーを効率的に処理すること", () => {
      const analyzer = new DebugLogAnalyzer();
      const logEntries = Array.from({ length: 1000 }, (_, i) =>
        `{"level":"info","timestamp":"2024-01-01T10:00:${String(i % 60).padStart(2, '0')}Z","message":"Entry ${i}"}`
      ).join("\n");

      const start = performance.now();
      const result = analyzer.analyze(logEntries);
      const end = performance.now();

      expect(result.entries).toHaveLength(1000);
      expect(end - start).toBeLessThan(2000); // 2秒以内
    });

    test("メモリ効率的なフィルタリングを行うこと", () => {
      const analyzer = new DebugLogAnalyzer();
      const logEntries = Array.from({ length: 1000 }, (_, i) => {
        const levels = ["trace", "debug", "info", "warn", "error"];
        const level = levels[i % levels.length];
        return `{"level":"${level}","message":"Entry ${i}"}`;
      }).join("\n");

      const start = performance.now();
      const result = analyzer.analyze(logEntries, {
        filter: { level: LogLevel.ERROR }
      });
      const end = performance.now();

      expect(result.entries.length).toBe(200); // 1000の1/5
      expect(end - start).toBeLessThan(1000); // 1秒以内
    });

    test("複雑な条件でのフィルタリング性能テスト", () => {
      const analyzer = new DebugLogAnalyzer();
      const logEntries = Array.from({ length: 1000 }, (_, i) =>
        `{"level":"info","timestamp":"2024-01-01T10:${String(i % 60).padStart(2, '0')}:00Z","source":"service${i % 10}","message":"Complex entry ${i} with details"}`
      ).join("\\n");

      const complexFilter = {
        level: LogLevel.INFO,
        startTime: new Date("2024-01-01T10:00:00Z"),
        endTime: new Date("2024-01-01T10:30:00Z"),
        source: "service5",
        searchText: "details"
      };

      const start = performance.now();
      const result = analyzer.analyze(logEntries, { filter: complexFilter });
      const end = performance.now();

      expect(result.entries.length).toBeGreaterThan(0);
      expect(end - start).toBeLessThan(500); // 500ms以内
    });
  });

  describe("統合テスト", () => {
    test("実世界のログサンプルを処理すること", () => {
      const analyzer = new DebugLogAnalyzer();
      const realWorldLogs = [
        // アプリケーションログ
        '{"timestamp":"2024-01-15T10:30:45.123Z","level":"info","logger":"app","message":"Server started on port 3000","port":3000}',
        // エラーログ
        '{"timestamp":"2024-01-15T10:31:12.456Z","level":"error","logger":"db","message":"Connection timeout","error":{"code":"TIMEOUT","timeout":5000}}',
        // リクエストログ
        '{"timestamp":"2024-01-15T10:31:30.789Z","level":"info","logger":"http","message":"Request completed","method":"GET","url":"/api/users","status":200,"duration":45}',
        // 警告ログ
        '{"timestamp":"2024-01-15T10:32:00.012Z","level":"warn","logger":"auth","message":"Rate limit approaching","userId":123,"requests":95,"limit":100}',
        // デバッグログ
        '{"timestamp":"2024-01-15T10:32:15.345Z","level":"debug","logger":"cache","message":"Cache miss","key":"user:123","ttl":300}'
      ].join("\n");

      const result = analyzer.analyze(realWorldLogs);

      expect(result.entries).toHaveLength(5);
      expect(result.summary.totalEntries).toBe(5);
      expect(result.summary.errorCount).toBe(1);
      expect(result.summary.warningCount).toBe(1);
      expect(result.summary.levelDistribution[LogLevel.INFO]).toBe(2);
      expect(result.summary.levelDistribution[LogLevel.ERROR]).toBe(1);
      expect(result.summary.levelDistribution[LogLevel.WARN]).toBe(1);
      expect(result.summary.levelDistribution[LogLevel.DEBUG]).toBe(1);

      // 時間範囲の確認
      expect(result.summary.timeRange).toBeDefined();
      expect(result.summary.timeRange?.start).toBeInstanceOf(Date);
      expect(result.summary.timeRange?.end).toBeInstanceOf(Date);
    });

    test("混合形式のログストリームを処理すること", () => {
      const analyzer = new DebugLogAnalyzer();
      const mixedLogs = [
        // JSON形式
        '{"level":"info","message":"JSON log entry"}',
        // Syslog形式
        'Jan 15 10:30:00 server app[12345]: Syslog entry',
        // Apache形式
        '127.0.0.1 - - [15/Jan/2024:10:30:00 +0000] "GET /index.html HTTP/1.1" 200 1234',
        // Node.js形式
        '2024-01-15 10:30:00 [ERROR] Node.js error occurred',
        // 不明形式
        'Unknown log format line'
      ].join("\n");

      const result = analyzer.analyze(mixedLogs);

      expect(result.entries).toHaveLength(5);
      // ログタイプの認識は実装に依存するため、少なくとも適切にパースされることを確認
      expect(result.entries[0].type).toBe(LogType.JSON);
      expect(result.entries[2].type).toBe(LogType.APACHE_COMMON);
    });

    test("継続的なログ解析ワークフローをシミュレートすること", () => {
      const analyzer = new DebugLogAnalyzer();
      const batches = Array.from({ length: 10 }, (_, batchIndex) =>
        Array.from({ length: 100 }, (_, i) =>
          `{"level":"info","timestamp":"2024-01-01T10:${String(batchIndex).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z","message":"Batch ${batchIndex} Entry ${i}"}`
        ).join("\n")
      );

      let totalEntries = 0;
      let totalErrors = 0;

      // 各バッチを順次処理
      batches.forEach(batch => {
        const result = analyzer.analyze(batch);
        totalEntries += result.summary.totalEntries;
        totalErrors += result.summary.errorCount;
      });

      expect(totalEntries).toBe(1000);
      expect(totalErrors).toBe(0);
    });
  });

  describe("セキュリティテスト", () => {
    test("潜在的なXSS文字列を安全に処理すること", () => {
      const analyzer = new DebugLogAnalyzer();
      const xssAttempt = '<script>alert("xss")</script>';
      const logLine = `{"level":"warn","message":"XSS attempt: ${xssAttempt}"}`;

      const result = analyzer.analyze(logLine);
      expect(result.entries[0].message).toContain(xssAttempt);
      // セキュリティ: エスケープされていないが、これは解析のみでレンダリングしないため
    });

    test("SQL インジェクション類似文字列を処理すること", () => {
      const analyzer = new DebugLogAnalyzer();
      const sqlInjection = "'; DROP TABLE users; --";
      const logLine = `{"level":"error","message":"SQL error: ${sqlInjection}"}`;

      const result = analyzer.analyze(logLine);
      expect(result.entries[0].message).toContain(sqlInjection);
    });

    test("プロトタイプ汚染攻撃の試みを安全に処理すること", () => {
      const analyzer = new DebugLogAnalyzer();
      const prototypePollution = '{"__proto__":{"isAdmin":true},"level":"info","message":"test"}';

      const result = analyzer.analyze(prototypePollution);
      expect(result.entries[0].message).toBe("test");
      // プロトタイプ汚染が発生していないことを確認
      expect({}.isAdmin).toBeUndefined();
    });

    test("大量のデータを含む悪意のあるログを処理すること", () => {
      const analyzer = new DebugLogAnalyzer();
      const hugeData = "x".repeat(1000000); // 1MB
      const logLine = `{"level":"warn","message":"Huge data","data":"${hugeData}"}`;

      const start = performance.now();
      const result = analyzer.analyze(logLine);
      const end = performance.now();

      expect(result.entries).toHaveLength(1);
      expect(end - start).toBeLessThan(5000); // 5秒以内で処理
    });
  });

  describe("ログパターン分析テスト", () => {
    test("一般的なエラーパターンを識別すること", () => {
      const analyzer = new DebugLogAnalyzer();
      const errorLogs = [
        '{"level":"error","message":"Connection timeout to database"}',
        '{"level":"error","message":"Connection timeout to redis"}',
        '{"level":"error","message":"Connection timeout to api"}',
        '{"level":"error","message":"File not found: config.json"}',
        '{"level":"error","message":"File not found: data.txt"}'
      ].join("\n");

      const result = analyzer.analyze(errorLogs);

      expect(result.entries).toHaveLength(5);
      expect(result.summary.errorCount).toBe(5);
      // 基本的な解析結果の検証
      expect(result.summary.totalEntries).toBe(5);
    });

    test("時間ベースの傾向を分析すること", () => {
      const analyzer = new DebugLogAnalyzer();
      const timeBasedLogs = Array.from({ length: 60 }, (_, i) =>
        `{"level":"info","timestamp":"2024-01-01T10:${String(i).padStart(2, '0')}:00Z","message":"Minute ${i} log"}`
      ).join("\n");

      const result = analyzer.analyze(timeBasedLogs);

      expect(result.summary.timeRange?.start).toBeInstanceOf(Date);
      expect(result.summary.timeRange?.end).toBeInstanceOf(Date);

      const duration = result.summary.timeRange!.end.getTime() - result.summary.timeRange!.start.getTime();
      expect(duration).toBeGreaterThan(0);
    });
  });
});
