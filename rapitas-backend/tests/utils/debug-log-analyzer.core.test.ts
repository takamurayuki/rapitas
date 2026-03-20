/**
 * Debug Log Analyzer Core Tests
 *
 * Tests for main analysis functionality and core features.
 */
import { describe, test, expect } from 'bun:test';
import {
  DebugLogAnalyzer,
  LogType,
  LogLevel,
} from '../../utils/debug-log-analyzer';

describe('DebugLogAnalyzer', () => {
  const analyzer = new DebugLogAnalyzer();

  describe('detectLogType', () => {
    test('JSONログタイプを検出すること', () => {
      const content = '{"level":"info","message":"hello"}\n{"level":"error","message":"fail"}';
      expect(analyzer.detectLogType(content)).toBe(LogType.JSON);
    });

    test('空のログでUNKNOWNを返すこと', () => {
      expect(analyzer.detectLogType('')).toBe(LogType.UNKNOWN);
      expect(analyzer.detectLogType('  \n  \n  ')).toBe(LogType.UNKNOWN);
    });

    test('パースできないログでUNKNOWNを返すこと', () => {
      expect(analyzer.detectLogType('random text\nanother line')).toBe(LogType.UNKNOWN);
    });
  });

  describe('analyze', () => {
    test('JSONログを解析してサマリーを生成すること', () => {
      const content = [
        '{"level":"info","message":"Started"}',
        '{"level":"error","message":"Failed to connect"}',
        '{"level":"warn","message":"Slow query"}',
        '{"level":"info","message":"Completed"}',
      ].join('\n');

      const result = analyzer.analyze(content);
      expect(result.summary.totalEntries).toBe(4);
      expect(result.summary.errorCount).toBe(1);
      expect(result.summary.warningCount).toBe(1);
      expect(result.summary.levelDistribution[LogLevel.INFO]).toBe(2);
      expect(result.summary.levelDistribution[LogLevel.ERROR]).toBe(1);
      expect(result.summary.levelDistribution[LogLevel.WARN]).toBe(1);
    });

    test('パースできない行をUNKNOWNエントリとして保持すること', () => {
      const result = analyzer.analyze('unparseable line');
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].type).toBe(LogType.UNKNOWN);
      expect(result.entries[0].message).toBe('unparseable line');
    });

    test('エラーパターンを抽出すること', () => {
      const content = [
        '{"level":"error","message":"Connection timeout to db-1"}',
        '{"level":"error","message":"Connection timeout to db-2"}',
      ].join('\n');

      const result = analyzer.analyze(content);
      expect(result.patterns.errors.length).toBeGreaterThan(0);
    });

    test('頻出メッセージパターンを集約すること', () => {
      const content = Array(5)
        .fill('{"level":"info","message":"Request processed in 100ms"}')
        .join('\n');

      const result = analyzer.analyze(content);
      expect(result.patterns.frequentMessages.length).toBeGreaterThan(0);
      expect(result.patterns.frequentMessages[0].count).toBeGreaterThanOrEqual(1);
    });

    test('サンプルを最大3件に制限すること', () => {
      const content = Array(10).fill('{"level":"info","message":"repeated"}').join('\n');

      const result = analyzer.analyze(content);
      for (const pattern of result.patterns.frequentMessages) {
        expect(pattern.samples.length).toBeLessThanOrEqual(3);
      }
    });

    test('ソース分布を計算すること', () => {
      const content = [
        '{"level":"info","message":"test","source":"app"}',
        '{"level":"info","message":"test","source":"app"}',
        '{"level":"info","message":"test","source":"db"}',
      ].join('\n');

      const result = analyzer.analyze(content);
      expect(result.summary.sourceDistribution['app']).toBe(2);
      expect(result.summary.sourceDistribution['db']).toBe(1);
    });
  });

  describe('analyze with filter', () => {
    const content = [
      '{"level":"debug","message":"Debug msg"}',
      '{"level":"info","message":"Info msg"}',
      '{"level":"error","message":"Error msg"}',
    ].join('\n');

    test('レベルフィルタでエラー以上のみ返すこと', () => {
      const result = analyzer.analyze(content, {
        filter: { level: LogLevel.ERROR },
      });
      expect(result.summary.totalEntries).toBe(1);
      expect(result.entries[0].level).toBe(LogLevel.ERROR);
    });

    test('テキスト検索フィルタが動作すること', () => {
      const result = analyzer.analyze(content, {
        filter: { searchText: 'Info' },
      });
      expect(result.summary.totalEntries).toBe(1);
      expect(result.entries[0].message).toBe('Info msg');
    });

    test('ソースフィルタが動作すること', () => {
      const content2 = [
        '{"level":"info","message":"test","source":"app-server"}',
        '{"level":"info","message":"test","source":"db-server"}',
      ].join('\n');

      const result = analyzer.analyze(content2, {
        filter: { source: 'app' },
      });
      expect(result.summary.totalEntries).toBe(1);
    });
  });

  describe('analyzeStream', () => {
    test('非同期イテレータからログを解析すること', async () => {
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

    test('空行をスキップすること', async () => {
      async function* lines() {
        yield '{"level":"info","message":"line1"}';
        yield '';
        yield '  ';
        yield '{"level":"info","message":"line2"}';
      }

      const entries = [];
      for await (const entry of analyzer.analyzeStream(lines())) {
        entries.push(entry);
      }
      expect(entries.length).toBe(2);
    });

    test('フィルタ付きストリーム解析が動作すること', async () => {
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

  describe('addParser', () => {
    test('カスタムパーサーを先頭に追加できること', () => {
      const customAnalyzer = new DebugLogAnalyzer();
      const customParser = {
        type: LogType.CUSTOM,
        canParse: (line: string) => line.startsWith('CUSTOM:'),
        parse: (line: string) => ({
          raw: line,
          type: LogType.CUSTOM,
          message: line.replace('CUSTOM:', '').trim(),
          level: LogLevel.INFO,
        }),
      };

      customAnalyzer.addParser(customParser);
      const result = customAnalyzer.analyze('CUSTOM: Hello world');
      expect(result.entries[0].type).toBe(LogType.CUSTOM);
      expect(result.entries[0].message).toBe('Hello world');
    });

    test('複数のカスタムパーサーを追加できること', () => {
      const analyzer = new DebugLogAnalyzer();

      const parser1 = {
        type: LogType.CUSTOM,
        canParse: (line: string) => line.startsWith('TYPE1:'),
        parse: (line: string) => ({
          raw: line,
          type: LogType.CUSTOM,
          message: line.replace('TYPE1:', '').trim(),
          level: LogLevel.DEBUG,
        }),
      };

      const parser2 = {
        type: LogType.CUSTOM,
        canParse: (line: string) => line.startsWith('TYPE2:'),
        parse: (line: string) => ({
          raw: line,
          type: LogType.CUSTOM,
          message: line.replace('TYPE2:', '').trim(),
          level: LogLevel.WARN,
        }),
      };

      analyzer.addParser(parser1);
      analyzer.addParser(parser2);

      const logs = 'TYPE1: First message\nTYPE2: Second message';
      const result = analyzer.analyze(logs);

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].message).toBe('First message');
      expect(result.entries[1].message).toBe('Second message');
    });
  });

  describe('エッジケースとエラーハンドリング', () => {
    test('非常に長いログ行を処理すること', () => {
      const analyzer = new DebugLogAnalyzer();
      const longMessage = 'x'.repeat(100000);
      const logLine = `{"level":"info","message":"${longMessage}"}`;

      const result = analyzer.analyze(logLine);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].message).toBe(longMessage);
    });

    test('改行文字を含むログメッセージを処理すること', () => {
      const analyzer = new DebugLogAnalyzer();
      const multilineMessage = 'Line 1\nLine 2\nLine 3';
      const logLine = JSON.stringify({ level: 'error', message: multilineMessage });

      const result = analyzer.analyze(logLine);
      expect(result.entries[0].message).toBe(multilineMessage);
    });

    test('特殊文字を含むログを処理すること', () => {
      const analyzer = new DebugLogAnalyzer();
      const specialChars = "Special chars: !@#$%^&*(){}[]|:;'<>?,./-+=~`";
      const logLine = JSON.stringify({ level: 'info', message: specialChars });

      const result = analyzer.analyze(logLine);
      expect(result.entries[0].message).toBe(specialChars);
    });

    test('Unicodeサロゲートペアを含むログを処理すること', () => {
      const analyzer = new DebugLogAnalyzer();
      const unicodeMessage = 'Unicode: 𝓣𝓮𝓼𝓽 🚀 𝕌𝕟𝕚𝕔𝕠𝕕𝕖';
      const logLine = `{"level":"info","message":"${unicodeMessage}"}`;

      const result = analyzer.analyze(logLine);
      expect(result.entries[0].message).toBe(unicodeMessage);
    });

    test('null値やundefinedを含むJSONログを処理すること', () => {
      const analyzer = new DebugLogAnalyzer();
      const logLine = '{"level":"info","message":"test","nullField":null}';

      const result = analyzer.analyze(logLine);
      expect(result.entries[0].message).toBe('test');
      expect(result.entries[0].metadata).toBeDefined();
    });

    test('深くネストしたオブジェクトを含むログを処理すること', () => {
      const analyzer = new DebugLogAnalyzer();
      const nestedData = {
        level: 'error',
        message: 'Nested error',
        context: {
          user: { id: 123, name: 'test' },
          request: { method: 'POST', url: '/api/test' },
          error: { code: 500, details: { timeout: true } },
        },
      };
      const logLine = JSON.stringify(nestedData);

      const result = analyzer.analyze(logLine);
      expect(result.entries[0].metadata?.context).toBeDefined();
    });

    test('循環参照を含む可能性のあるログ構造をハンドリングすること', () => {
      const analyzer = new DebugLogAnalyzer();
      // Circular refs cause JSON.stringify errors, but we test with already-stringified logs
      const logLine = '{"level":"error","message":"Circular ref handled","data":"[Circular]"}';

      const result = analyzer.analyze(logLine);
      expect(result.entries[0].message).toBe('Circular ref handled');
    });
  });
});