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

  test("有効なJSONログをパースできること", () => {
    const log = JSON.stringify({
      timestamp: "2026-01-01T10:00:00Z",
      level: "error",
      message: "Connection failed",
      source: "db-service",
    });
    expect(parser.canParse(log)).toBe(true);
    const result = parser.parse(log);
    expect(result).not.toBeNull();
    expect(result!.level).toBe(LogLevel.ERROR);
    expect(result!.message).toBe("Connection failed");
    expect(result!.source).toBe("db-service");
    expect(result!.type).toBe(LogType.JSON);
  });

  test("severityフィールドもレベルとして認識すること", () => {
    const log = JSON.stringify({ severity: "warning", msg: "Low memory" });
    const result = parser.parse(log);
    expect(result!.level).toBe(LogLevel.WARN);
    expect(result!.message).toBe("Low memory");
  });

  test("レベルが未指定の場合INFOになること", () => {
    const log = JSON.stringify({ message: "Hello" });
    const result = parser.parse(log);
    expect(result!.level).toBe(LogLevel.INFO);
  });

  test("不正なJSONでcanParseがfalseを返すこと", () => {
    expect(parser.canParse("not json")).toBe(false);
  });

  test("不正なJSONでparseがnullを返すこと", () => {
    expect(parser.parse("not json")).toBeNull();
  });

  test("各レベル文字列を正しく正規化すること", () => {
    const cases: [string, LogLevel][] = [
      ["trace", LogLevel.TRACE],
      ["debug", LogLevel.DEBUG],
      ["info", LogLevel.INFO],
      ["information", LogLevel.INFO],
      ["warn", LogLevel.WARN],
      ["warning", LogLevel.WARN],
      ["error", LogLevel.ERROR],
      ["err", LogLevel.ERROR],
      ["fatal", LogLevel.FATAL],
      ["critical", LogLevel.FATAL],
    ];
    for (const [level, expected] of cases) {
      const log = JSON.stringify({ level, message: "test" });
      expect(parser.parse(log)!.level).toBe(expected);
    }
  });
});

describe("SyslogParser", () => {
  const parser = new SyslogParser();

  test("Syslogフォーマットをパースできること", () => {
    const log = "<13>Jan  1 10:00:00 myhost sshd[1234]: Connection accepted";
    expect(parser.canParse(log)).toBe(true);
    const result = parser.parse(log);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("sshd[1234]");
    expect(result!.message).toBe("Connection accepted");
    expect(result!.metadata!.hostname).toBe("myhost");
    expect(result!.metadata!.pid).toBe(1234);
  });

  test("severity 0-2がFATALになること", () => {
    // priority = facility * 8 + severity. severity=0: priority=0
    const log = "<0>Jan  1 10:00:00 host app[1]: Emergency";
    const result = parser.parse(log);
    expect(result!.level).toBe(LogLevel.FATAL);
  });

  test("severity 3がERRORになること", () => {
    const log = "<3>Jan  1 10:00:00 host app[1]: Error occurred";
    const result = parser.parse(log);
    expect(result!.level).toBe(LogLevel.ERROR);
  });

  test("severity 4がWARNになること", () => {
    const log = "<4>Jan  1 10:00:00 host app[1]: Warning message";
    const result = parser.parse(log);
    expect(result!.level).toBe(LogLevel.WARN);
  });

  test("severity 7がDEBUGになること", () => {
    const log = "<7>Jan  1 10:00:00 host app[1]: Debug info";
    const result = parser.parse(log);
    expect(result!.level).toBe(LogLevel.DEBUG);
  });

  test("不正なフォーマットでcanParseがfalseを返すこと", () => {
    expect(parser.canParse("not a syslog")).toBe(false);
  });
});

describe("ApacheCommonLogParser", () => {
  const parser = new ApacheCommonLogParser();

  test("Apache Common Logフォーマットをパースできること", () => {
    const log =
      '127.0.0.1 - frank [01/Jan/2026:10:00:00 +0000] "GET /index.html HTTP/1.1" 200 1234';
    expect(parser.canParse(log)).toBe(true);
    const result = parser.parse(log);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("127.0.0.1");
    expect(result!.metadata!.user).toBe("frank");
    expect(result!.metadata!.statusCode).toBe(200);
    expect(result!.type).toBe(LogType.APACHE_COMMON);
  });

  test("user=-でundefinedになること", () => {
    const log =
      '127.0.0.1 - - [01/Jan/2026:10:00:00 +0000] "GET / HTTP/1.1" 200 100';
    const result = parser.parse(log);
    expect(result!.metadata!.user).toBeUndefined();
  });

  test("ステータスコード別のレベル判定", () => {
    const makeLog = (status: number) =>
      `127.0.0.1 - - [01/Jan/2026:10:00:00 +0000] "GET / HTTP/1.1" ${status} 100`;

    expect(parser.parse(makeLog(200))!.level).toBe(LogLevel.INFO);
    expect(parser.parse(makeLog(301))!.level).toBe(LogLevel.INFO);
    expect(parser.parse(makeLog(404))!.level).toBe(LogLevel.WARN);
    expect(parser.parse(makeLog(500))!.level).toBe(LogLevel.ERROR);
  });
});

describe("NodeJSLogParser", () => {
  const parser = new NodeJSLogParser();

  test("[timestamp] LEVEL: message形式をパースできること", () => {
    const log = "[2026-01-01T10:00:00.000Z] ERROR: Something went wrong";
    expect(parser.canParse(log)).toBe(true);
    const result = parser.parse(log);
    expect(result).not.toBeNull();
    expect(result!.level).toBe(LogLevel.ERROR);
    expect(result!.message).toBe("Something went wrong");
  });

  test("LEVEL [timestamp] message形式をパースできること", () => {
    const log = "WARN [2026-01-01T10:00:00.000Z] Deprecated function called";
    const result = parser.parse(log);
    expect(result).not.toBeNull();
    expect(result!.level).toBe(LogLevel.WARN);
    expect(result!.message).toBe("Deprecated function called");
  });

  test("timestamp - LEVEL - message形式をパースできること", () => {
    const log = "2026-01-01T10:00:00.000Z - INFO - Server started";
    const result = parser.parse(log);
    expect(result).not.toBeNull();
    expect(result!.level).toBe(LogLevel.INFO);
    expect(result!.message).toBe("Server started");
  });

  test("各レベルを正しくマッピングすること", () => {
    const levels: [string, LogLevel][] = [
      ["TRACE", LogLevel.TRACE],
      ["DEBUG", LogLevel.DEBUG],
      ["INFO", LogLevel.INFO],
      ["WARN", LogLevel.WARN],
      ["ERROR", LogLevel.ERROR],
      ["FATAL", LogLevel.FATAL],
    ];
    for (const [level, expected] of levels) {
      const log = `[2026-01-01T10:00:00Z] ${level}: test`;
      expect(parser.parse(log)!.level).toBe(expected);
    }
  });
});

describe("DebugLogAnalyzer", () => {
  const analyzer = new DebugLogAnalyzer();

  describe("detectLogType", () => {
    test("JSONログを識別すること", () => {
      const content = [
        '{"level":"info","message":"Started"}',
        '{"level":"error","message":"Failed"}',
      ].join("\n");
      expect(analyzer.detectLogType(content)).toBe(LogType.JSON);
    });

    test("Node.jsログを識別すること", () => {
      const content = [
        "[2026-01-01T10:00:00Z] INFO: Started",
        "[2026-01-01T10:00:01Z] ERROR: Failed",
      ].join("\n");
      expect(analyzer.detectLogType(content)).toBe(LogType.NODEJS);
    });

    test("空のコンテンツでUNKNOWNを返すこと", () => {
      expect(analyzer.detectLogType("")).toBe(LogType.UNKNOWN);
      expect(analyzer.detectLogType("  \n  ")).toBe(LogType.UNKNOWN);
    });
  });

  describe("analyze", () => {
    test("レベル分布を正しく集計すること", () => {
      const content = [
        '{"level":"info","message":"A"}',
        '{"level":"error","message":"B"}',
        '{"level":"error","message":"C"}',
        '{"level":"warn","message":"D"}',
      ].join("\n");

      const result = analyzer.analyze(content);
      expect(result.summary.totalEntries).toBe(4);
      expect(result.summary.errorCount).toBe(2);
      expect(result.summary.warningCount).toBe(1);
      expect(result.summary.levelDistribution[LogLevel.INFO]).toBe(1);
      expect(result.summary.levelDistribution[LogLevel.ERROR]).toBe(2);
      expect(result.summary.levelDistribution[LogLevel.WARN]).toBe(1);
    });

    test("ソース分布を集計すること", () => {
      const content = [
        '{"level":"info","message":"A","source":"api"}',
        '{"level":"info","message":"B","source":"api"}',
        '{"level":"info","message":"C","source":"db"}',
      ].join("\n");

      const result = analyzer.analyze(content);
      expect(result.summary.sourceDistribution["api"]).toBe(2);
      expect(result.summary.sourceDistribution["db"]).toBe(1);
    });

    test("時間範囲を検出すること", () => {
      const content = [
        '{"timestamp":"2026-01-01T10:00:00Z","level":"info","message":"A"}',
        '{"timestamp":"2026-01-01T12:00:00Z","level":"info","message":"B"}',
        '{"timestamp":"2026-01-01T14:00:00Z","level":"info","message":"C"}',
      ].join("\n");

      const result = analyzer.analyze(content);
      expect(result.summary.timeRange).toBeDefined();
      expect(result.summary.timeRange!.start.getUTCHours()).toBe(10);
      expect(result.summary.timeRange!.end.getUTCHours()).toBe(14);
    });

    test("エラーパターンを抽出すること", () => {
      const content = [
        '{"level":"error","message":"Connection timeout at 192.168.1.1"}',
        '{"level":"error","message":"Connection timeout at 10.0.0.1"}',
      ].join("\n");

      const result = analyzer.analyze(content);
      expect(result.patterns.errors.length).toBeGreaterThan(0);
    });

    test("頻出メッセージパターンを集計すること", () => {
      const content = Array(5)
        .fill('{"level":"info","message":"Request handled"}')
        .join("\n");

      const result = analyzer.analyze(content);
      expect(result.patterns.frequentMessages.length).toBeGreaterThan(0);
      expect(result.patterns.frequentMessages[0].count).toBe(5);
    });

    test("パースできない行をUNKNOWNとして保存すること", () => {
      const content = "random text that cannot be parsed";
      const result = analyzer.analyze(content);
      expect(result.entries[0].type).toBe(LogType.UNKNOWN);
      expect(result.entries[0].message).toBe(content);
    });
  });

  describe("analyze - フィルタリング", () => {
    const content = [
      '{"level":"debug","message":"D","timestamp":"2026-01-01T10:00:00Z","source":"api"}',
      '{"level":"info","message":"I","timestamp":"2026-01-01T11:00:00Z","source":"api"}',
      '{"level":"warn","message":"W","timestamp":"2026-01-01T12:00:00Z","source":"db"}',
      '{"level":"error","message":"E","timestamp":"2026-01-01T13:00:00Z","source":"db"}',
    ].join("\n");

    test("レベルフィルタが適用されること", () => {
      const result = analyzer.analyze(content, {
        filter: { level: LogLevel.WARN },
      });
      expect(result.summary.totalEntries).toBe(2); // warn + error
    });

    test("時間範囲フィルタが適用されること", () => {
      const result = analyzer.analyze(content, {
        filter: {
          startTime: new Date("2026-01-01T11:00:00Z"),
          endTime: new Date("2026-01-01T12:30:00Z"),
        },
      });
      expect(result.summary.totalEntries).toBe(2); // info + warn
    });

    test("ソースフィルタが適用されること", () => {
      const result = analyzer.analyze(content, {
        filter: { source: "db" },
      });
      expect(result.summary.totalEntries).toBe(2);
    });

    test("テキスト検索フィルタが適用されること", () => {
      const result = analyzer.analyze(content, {
        filter: { searchText: "W" },
      });
      expect(result.summary.totalEntries).toBe(1);
    });
  });

  describe("analyzeStream", () => {
    test("AsyncIterableからエントリーを生成すること", async () => {
      async function* generateLines() {
        yield '{"level":"info","message":"A"}';
        yield '{"level":"error","message":"B"}';
      }

      const entries = [];
      for await (const entry of analyzer.analyzeStream(generateLines())) {
        entries.push(entry);
      }
      expect(entries).toHaveLength(2);
      expect(entries[0].level).toBe(LogLevel.INFO);
      expect(entries[1].level).toBe(LogLevel.ERROR);
    });

    test("空行をスキップすること", async () => {
      async function* generateLines() {
        yield '{"level":"info","message":"A"}';
        yield "  ";
        yield '{"level":"info","message":"B"}';
      }

      const entries = [];
      for await (const entry of analyzer.analyzeStream(generateLines())) {
        entries.push(entry);
      }
      expect(entries).toHaveLength(2);
    });

    test("フィルタが適用されること", async () => {
      async function* generateLines() {
        yield '{"level":"debug","message":"D"}';
        yield '{"level":"error","message":"E"}';
      }

      const entries = [];
      for await (const entry of analyzer.analyzeStream(generateLines(), {
        filter: { level: LogLevel.ERROR },
      })) {
        entries.push(entry);
      }
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe(LogLevel.ERROR);
    });
  });

  describe("addParser", () => {
    test("カスタムパーサーを追加できること", () => {
      const customAnalyzer = new DebugLogAnalyzer();
      customAnalyzer.addParser({
        type: LogType.CUSTOM,
        canParse: (line) => line.startsWith("CUSTOM:"),
        parse: (line) => ({
          raw: line,
          type: LogType.CUSTOM,
          message: line.substring(7),
          level: LogLevel.INFO,
        }),
      });

      const result = customAnalyzer.analyze("CUSTOM:Hello World");
      expect(result.entries[0].type).toBe(LogType.CUSTOM);
      expect(result.entries[0].message).toBe("Hello World");
    });
  });
});
