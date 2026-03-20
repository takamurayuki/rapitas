'use client';

/**
 * execution-log-viewer/LogEntry.tsx
 *
 * Memoized single-row renderer for the detailed log view.
 * Applies colour coding, file-path highlighting, search term marking,
 * and entry-appear animations.  Does not manage any state.
 */

import React, { memo } from 'react';
import { formatLogLine } from './log-format-utils';

type LogEntryProps = {
  log: string;
  index: number;
  isNewEntry: boolean;
  searchQuery: string;
  highlightText: (text: string, query: string) => React.ReactNode;
};

/**
 * Renders a single detailed-mode log line with semantic colour coding.
 *
 * @param log - Raw log string for this row. / この行の生ログ文字列。
 * @param index - Row index used as React key. / React key として使うインデックス。
 * @param isNewEntry - Whether to play the fade-in animation. / フェードインアニメーションを再生するか。
 * @param searchQuery - Active search query for highlight rendering. / ハイライト描画に使う検索クエリ。
 * @param highlightText - Callback that wraps matches in `<mark>` elements. / マッチ箇所を `<mark>` で包むコールバック。
 */
const LogEntry = memo<LogEntryProps>(
  ({ log, index, isNewEntry, searchQuery, highlightText }) => {
    const { formatted, hasJson, isError, isPhaseTransition, filePaths } =
      formatLogLine(log);

    // Emphasize error messages with red background block
    if (isError) {
      return (
        <span
          key={index}
          className={`block px-2 py-1 my-0.5 bg-red-950/50 border-l-2 border-red-500 text-red-400 ${isNewEntry ? 'log-entry-new' : ''}`}
          style={{
            animation: isNewEntry ? 'fadeInSlide 0.3s ease-out' : undefined,
          }}
        >
          {searchQuery ? highlightText(formatted, searchQuery) : formatted}
        </span>
      );
    }

    // Special styling for phase transitions
    if (isPhaseTransition) {
      return (
        <span
          key={index}
          className={`block px-2 py-0.5 my-0.5 bg-indigo-950/30 border-l-2 border-indigo-500 text-indigo-300 font-medium ${isNewEntry ? 'log-entry-new' : ''}`}
          style={{
            animation: isNewEntry ? 'fadeInSlide 0.3s ease-out' : undefined,
          }}
        >
          {searchQuery ? highlightText(formatted, searchQuery) : formatted}
        </span>
      );
    }

    const className = [
      log.includes('[Error]')
        ? 'text-red-400'
        : log.includes('[エージェント]')
          ? 'text-emerald-400 font-semibold'
          : log.includes('[実行開始]') ||
              log.includes('[継続]') ||
              log.includes('[完了]') ||
              log.includes('フェーズ完了]')
            ? 'text-blue-400'
            : /^\[.+?\]/.test(log.trimStart())
              ? 'text-cyan-400'
              : hasJson
                ? 'text-amber-300/90'
                : '',
      isNewEntry ? 'log-entry-new' : '',
      filePaths ? 'file-path-line' : '',
    ]
      .filter(Boolean)
      .join(' ');

    // Display file paths with monospace + colour coding
    let content: React.ReactNode = searchQuery
      ? highlightText(formatted, searchQuery)
      : formatted;

    if (filePaths && !searchQuery) {
      let result = formatted;
      for (const fp of filePaths) {
        result = result.replace(fp, `\x00FP_START\x00${fp}\x00FP_END\x00`);
      }
      const segments = result.split(/\x00(FP_START|FP_END)\x00/);
      let inFilePath = false;
      content = segments.map((seg, i) => {
        if (seg === 'FP_START') {
          inFilePath = true;
          return null;
        }
        if (seg === 'FP_END') {
          inFilePath = false;
          return null;
        }
        if (inFilePath) {
          return (
            <span key={i} className="text-cyan-300 font-mono">
              {seg}
            </span>
          );
        }
        return seg;
      });
    }

    return (
      <span
        key={index}
        className={className}
        style={{
          display: 'block',
          animation: isNewEntry ? 'fadeInSlide 0.3s ease-out' : undefined,
        }}
      >
        {content}
      </span>
    );
  },
);

LogEntry.displayName = 'LogEntry';

export { LogEntry };
