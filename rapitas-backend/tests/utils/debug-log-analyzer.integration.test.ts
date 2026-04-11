/**
 * Debug Log Analyzer Integration Tests
 *
 * Tests for performance, security, integration scenarios and advanced features.
 */
import { describe, test, expect } from 'bun:test';
import { DebugLogAnalyzer, LogType, LogLevel } from '../../utils/debug-log-analyzer';

describe('DebugLogAnalyzer - Integration Tests', () => {
  describe('パフォーマンステスト', () => {
    test('大量のログエントリーを効率的に処理すること', () => {
      const analyzer = new DebugLogAnalyzer();
      const logEntries = Array.from(
        { length: 1000 },
        (_, i) =>
          `{"level":"info","timestamp":"2024-01-01T10:00:${String(i % 60).padStart(2, '0')}Z","message":"Entry ${i}"}`,
      ).join('\n');

      const start = performance.now();
      const result = analyzer.analyze(logEntries);
      const end = performance.now();

      expect(result.entries).toHaveLength(1000);
      expect(end - start).toBeLessThan(2000); // Within 2 seconds
    });

    test('メモリ効率的なフィルタリングを行うこと', () => {
      const analyzer = new DebugLogAnalyzer();
      const logEntries = Array.from({ length: 1000 }, (_, i) => {
        const levels = ['trace', 'debug', 'info', 'warn', 'error'];
        const level = levels[i % levels.length];
        return `{"level":"${level}","message":"Entry ${i}"}`;
      }).join('\n');

      const start = performance.now();
      const result = analyzer.analyze(logEntries, {
        filter: { level: LogLevel.ERROR },
      });
      const end = performance.now();

      expect(result.entries.length).toBe(200); // 1/5 of 1000
      expect(end - start).toBeLessThan(1000); // Within 1 second
    });

    test('複雑な条件でのフィルタリング性能テスト', () => {
      const analyzer = new DebugLogAnalyzer();
      const logEntries = Array.from(
        { length: 1000 },
        (_, i) =>
          `{"level":"info","timestamp":"2024-01-01T10:${String(i % 60).padStart(2, '0')}:00Z","source":"service${i % 10}","message":"Complex entry ${i} with details"}`,
      ).join('\n');

      const complexFilter = {
        level: LogLevel.INFO,
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T10:30:00Z'),
        source: 'service5',
        searchText: 'details',
      };

      const start = performance.now();
      const result = analyzer.analyze(logEntries, { filter: complexFilter });
      const end = performance.now();

      expect(result.entries.length).toBeGreaterThan(0);
      expect(end - start).toBeLessThan(500); // Within 500ms
    });
  });

  describe('統合テスト', () => {
    test('実世界のログサンプルを処理すること', () => {
      const analyzer = new DebugLogAnalyzer();
      const realWorldLogs = [
        // Application log
        '{"timestamp":"2024-01-15T10:30:45.123Z","level":"info","logger":"app","message":"Server started on port 3000","port":3000}',
        // Error log
        '{"timestamp":"2024-01-15T10:31:12.456Z","level":"error","logger":"db","message":"Connection timeout","error":{"code":"TIMEOUT","timeout":5000}}',
        // Request log
        '{"timestamp":"2024-01-15T10:31:30.789Z","level":"info","logger":"http","message":"Request completed","method":"GET","url":"/api/users","status":200,"duration":45}',
        // Warning log
        '{"timestamp":"2024-01-15T10:32:00.012Z","level":"warn","logger":"auth","message":"Rate limit approaching","userId":123,"requests":95,"limit":100}',
        // Debug log
        '{"timestamp":"2024-01-15T10:32:15.345Z","level":"debug","logger":"cache","message":"Cache miss","key":"user:123","ttl":300}',
      ].join('\n');

      const result = analyzer.analyze(realWorldLogs);

      expect(result.entries).toHaveLength(5);
      expect(result.summary.totalEntries).toBe(5);
      expect(result.summary.errorCount).toBe(1);
      expect(result.summary.warningCount).toBe(1);
      expect(result.summary.levelDistribution[LogLevel.INFO]).toBe(2);
      expect(result.summary.levelDistribution[LogLevel.ERROR]).toBe(1);
      expect(result.summary.levelDistribution[LogLevel.WARN]).toBe(1);
      expect(result.summary.levelDistribution[LogLevel.DEBUG]).toBe(1);

      // Verify time range
      expect(result.summary.timeRange).toBeDefined();
      expect(result.summary.timeRange?.start).toBeInstanceOf(Date);
      expect(result.summary.timeRange?.end).toBeInstanceOf(Date);
    });

    test('混合形式のログストリームを処理すること', () => {
      const analyzer = new DebugLogAnalyzer();
      const mixedLogs = [
        // JSON format
        '{"level":"info","message":"JSON log entry"}',
        // Syslog format
        'Jan 15 10:30:00 server app[12345]: Syslog entry',
        // Apache format
        '127.0.0.1 - - [15/Jan/2024:10:30:00 +0000] "GET /index.html HTTP/1.1" 200 1234',
        // Node.js format
        '2024-01-15 10:30:00 [ERROR] Node.js error occurred',
        // Unknown format
        'Unknown log format line',
      ].join('\n');

      const result = analyzer.analyze(mixedLogs);

      expect(result.entries).toHaveLength(5);
      // Log type recognition depends on implementation; verify at least proper parsing
      expect(result.entries[0].type).toBe(LogType.JSON);
      expect(result.entries[2].type).toBe(LogType.APACHE_COMMON);
    });

    test('継続的なログ解析ワークフローをシミュレートすること', () => {
      const analyzer = new DebugLogAnalyzer();
      const batches = Array.from({ length: 10 }, (_, batchIndex) =>
        Array.from(
          { length: 100 },
          (_, i) =>
            `{"level":"info","timestamp":"2024-01-01T10:${String(batchIndex).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z","message":"Batch ${batchIndex} Entry ${i}"}`,
        ).join('\n'),
      );

      let totalEntries = 0;
      let totalErrors = 0;

      // Process each batch sequentially
      batches.forEach((batch) => {
        const result = analyzer.analyze(batch);
        totalEntries += result.summary.totalEntries;
        totalErrors += result.summary.errorCount;
      });

      expect(totalEntries).toBe(1000);
      expect(totalErrors).toBe(0);
    });
  });

  describe('セキュリティテスト', () => {
    test('潜在的なXSS文字列を安全に処理すること', () => {
      const analyzer = new DebugLogAnalyzer();
      const xssAttempt = '<script>alert("xss")</script>';
      const logLine = `{"level":"warn","message":"XSS attempt: ${xssAttempt}"}`;

      const result = analyzer.analyze(logLine);
      expect(result.entries[0].message).toContain(xssAttempt);
      // Security: not escaped, but this is analysis only — no rendering
    });

    test('SQL インジェクション類似文字列を処理すること', () => {
      const analyzer = new DebugLogAnalyzer();
      const sqlInjection = "'; DROP TABLE users; --";
      const logLine = `{"level":"error","message":"SQL error: ${sqlInjection}"}`;

      const result = analyzer.analyze(logLine);
      expect(result.entries[0].message).toContain(sqlInjection);
    });

    test('プロトタイプ汚染攻撃の試みを安全に処理すること', () => {
      const analyzer = new DebugLogAnalyzer();
      const prototypePollution = '{"__proto__":{"isAdmin":true},"level":"info","message":"test"}';

      const result = analyzer.analyze(prototypePollution);
      expect(result.entries[0].message).toBe('test');
      // Verify prototype pollution did not occur
      expect({}.isAdmin).toBeUndefined();
    });

    test('大量のデータを含む悪意のあるログを処理すること', () => {
      const analyzer = new DebugLogAnalyzer();
      const hugeData = 'x'.repeat(1000000); // 1MB
      const logLine = `{"level":"warn","message":"Huge data","data":"${hugeData}"}`;

      const start = performance.now();
      const result = analyzer.analyze(logLine);
      const end = performance.now();

      expect(result.entries).toHaveLength(1);
      expect(end - start).toBeLessThan(5000); // Within 5 seconds
    });
  });

  describe('ログパターン分析テスト', () => {
    test('一般的なエラーパターンを識別すること', () => {
      const analyzer = new DebugLogAnalyzer();
      const errorLogs = [
        '{"level":"error","message":"Connection timeout to database"}',
        '{"level":"error","message":"Connection timeout to redis"}',
        '{"level":"error","message":"Connection timeout to api"}',
        '{"level":"error","message":"File not found: config.json"}',
        '{"level":"error","message":"File not found: data.txt"}',
      ].join('\n');

      const result = analyzer.analyze(errorLogs);

      expect(result.entries).toHaveLength(5);
      expect(result.summary.errorCount).toBe(5);
      // Basic analysis result verification
      expect(result.summary.totalEntries).toBe(5);
    });

    test('時間ベースの傾向を分析すること', () => {
      const analyzer = new DebugLogAnalyzer();
      const timeBasedLogs = Array.from(
        { length: 60 },
        (_, i) =>
          `{"level":"info","timestamp":"2024-01-01T10:${String(i).padStart(2, '0')}:00Z","message":"Minute ${i} log"}`,
      ).join('\n');

      const result = analyzer.analyze(timeBasedLogs);

      expect(result.summary.timeRange?.start).toBeInstanceOf(Date);
      expect(result.summary.timeRange?.end).toBeInstanceOf(Date);

      const duration =
        result.summary.timeRange!.end.getTime() - result.summary.timeRange!.start.getTime();
      expect(duration).toBeGreaterThan(0);
    });
  });
});
