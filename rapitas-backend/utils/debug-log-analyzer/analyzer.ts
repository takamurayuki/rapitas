/**
 * デバッグログ解析ツール - メインアナライザー
 * ログの解析、フィルタリング、パターン抽出を行うメインクラス
 */

import {
  LogType,
  LogLevel,
  type ParsedLogEntry,
  type LogAnalysisResult,
  type LogPattern,
  type LogParser,
  type AnalyzeOptions,
  type LogFilter
} from './types';
import {
  JSONLogParser,
  SyslogParser,
  ApacheCommonLogParser,
  NodeJSLogParser
} from './parsers';

// メインのログアナライザー
export class DebugLogAnalyzer {
  private parsers: LogParser[] = [
    new JSONLogParser(),
    new SyslogParser(),
    new ApacheCommonLogParser(),
    new NodeJSLogParser()
  ];

  // カスタムパーサーを追加
  addParser(parser: LogParser): void {
    this.parsers.unshift(parser);
  }

  // ログタイプを検出
  detectLogType(logContent: string): LogType {
    const lines = logContent.split('\n').filter(line => line.trim());
    if (lines.length === 0) return LogType.UNKNOWN;

    // 最初の数行でタイプを判定
    const sampleLines = lines.slice(0, Math.min(10, lines.length));

    for (const parser of this.parsers) {
      const canParseAll = sampleLines.every(line => parser.canParse(line));
      if (canParseAll) return parser.type;
    }

    return LogType.UNKNOWN;
  }

  // ログを解析
  analyze(logContent: string, options?: AnalyzeOptions): LogAnalysisResult {
    const lines = logContent.split('\n').filter(line => line.trim());
    const entries: ParsedLogEntry[] = [];

    // 各行を解析
    for (const line of lines) {
      let parsed: ParsedLogEntry | null = null;

      for (const parser of this.parsers) {
        if (parser.canParse(line)) {
          parsed = parser.parse(line);
          if (parsed) break;
        }
      }

      // パースできなかった場合は生のログとして保存
      if (!parsed) {
        parsed = {
          raw: line,
          type: LogType.UNKNOWN,
          message: line
        };
      }

      entries.push(parsed);
    }

    // フィルタリング
    let filteredEntries = entries;
    if (options?.filter) {
      filteredEntries = this.filterEntries(entries, options.filter);
    }

    // 解析結果を生成
    return this.generateAnalysisResult(filteredEntries);
  }

  // エントリーのフィルタリング
  private filterEntries(entries: ParsedLogEntry[], filter: LogFilter): ParsedLogEntry[] {
    return entries.filter(entry => {
      if (filter.level && entry.level) {
        const levelPriority = this.getLogLevelPriority(entry.level);
        const filterPriority = this.getLogLevelPriority(filter.level);
        if (levelPriority < filterPriority) return false;
      }

      if (filter.startTime && entry.timestamp) {
        if (entry.timestamp < filter.startTime) return false;
      }

      if (filter.endTime && entry.timestamp) {
        if (entry.timestamp > filter.endTime) return false;
      }

      if (filter.source && entry.source) {
        if (!entry.source.includes(filter.source)) return false;
      }

      if (filter.searchText && entry.message) {
        if (!entry.message.toLowerCase().includes(filter.searchText.toLowerCase())) {
          return false;
        }
      }

      return true;
    });
  }

  // ログレベルの優先度
  private getLogLevelPriority(level: LogLevel): number {
    const priorities: Record<LogLevel, number> = {
      [LogLevel.TRACE]: 0,
      [LogLevel.DEBUG]: 1,
      [LogLevel.INFO]: 2,
      [LogLevel.WARN]: 3,
      [LogLevel.ERROR]: 4,
      [LogLevel.FATAL]: 5
    };
    return priorities[level] ?? 2;
  }

  // 解析結果の生成
  private generateAnalysisResult(entries: ParsedLogEntry[]): LogAnalysisResult {
    const levelDistribution: Record<LogLevel, number> = {
      [LogLevel.TRACE]: 0,
      [LogLevel.DEBUG]: 0,
      [LogLevel.INFO]: 0,
      [LogLevel.WARN]: 0,
      [LogLevel.ERROR]: 0,
      [LogLevel.FATAL]: 0
    };

    const sourceDistribution: Record<string, number> = {};
    const messagePatterns = new Map<string, LogPattern>();
    let errorCount = 0;
    let warningCount = 0;
    let minTime: Date | undefined;
    let maxTime: Date | undefined;

    // エントリーの解析
    for (const entry of entries) {
      // レベル分布
      if (entry.level) {
        levelDistribution[entry.level]++;
        if (entry.level === LogLevel.ERROR || entry.level === LogLevel.FATAL) {
          errorCount++;
        } else if (entry.level === LogLevel.WARN) {
          warningCount++;
        }
      }

      // ソース分布
      if (entry.source) {
        sourceDistribution[entry.source] = (sourceDistribution[entry.source] || 0) + 1;
      }

      // 時間範囲
      if (entry.timestamp) {
        if (!minTime || entry.timestamp < minTime) minTime = entry.timestamp;
        if (!maxTime || entry.timestamp > maxTime) maxTime = entry.timestamp;
      }

      // メッセージパターン
      if (entry.message) {
        const pattern = this.extractPattern(entry.message);
        if (!messagePatterns.has(pattern)) {
          messagePatterns.set(pattern, {
            pattern,
            count: 0,
            samples: [],
            severity: entry.level
          });
        }
        const patternData = messagePatterns.get(pattern)!;
        patternData.count++;
        if (patternData.samples.length < 3) {
          patternData.samples.push(entry);
        }
      }
    }

    // パターンを分類
    const patterns = Array.from(messagePatterns.values());
    const errorPatterns = patterns.filter(p =>
      p.severity === LogLevel.ERROR || p.severity === LogLevel.FATAL
    );
    const warningPatterns = patterns.filter(p => p.severity === LogLevel.WARN);
    const frequentPatterns = patterns
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      entries,
      summary: {
        totalEntries: entries.length,
        errorCount,
        warningCount,
        timeRange: minTime && maxTime ? { start: minTime, end: maxTime } : undefined,
        levelDistribution,
        sourceDistribution
      },
      patterns: {
        errors: errorPatterns,
        warnings: warningPatterns,
        frequentMessages: frequentPatterns
      }
    };
  }

  // メッセージからパターンを抽出（数値や特定の文字列を正規化）
  private extractPattern(message: string): string {
    return message
      .replace(/\b\d+\b/g, '{NUMBER}')
      .replace(/\b[0-9a-fA-F]{8,}\b/g, '{HEX}')
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '{IP}')
      .replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, '{EMAIL}')
      .replace(/\/[^\/\s]+/g, '{PATH}');
  }

  // ログのストリーム解析（大きなファイル用）
  async *analyzeStream(
    logStream: AsyncIterable<string>,
    options?: AnalyzeOptions
  ): AsyncGenerator<ParsedLogEntry> {
    for await (const line of logStream) {
      if (!line.trim()) continue;

      let parsed: ParsedLogEntry | null = null;
      for (const parser of this.parsers) {
        if (parser.canParse(line)) {
          parsed = parser.parse(line);
          if (parsed) break;
        }
      }

      if (!parsed) {
        parsed = {
          raw: line,
          type: LogType.UNKNOWN,
          message: line
        };
      }

      // フィルタリング
      if (options?.filter) {
        const filtered = this.filterEntries([parsed], options.filter);
        if (filtered.length === 0) continue;
      }

      yield parsed;
    }
  }
}

// デフォルトのエクスポート
export default DebugLogAnalyzer;
