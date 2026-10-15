'use client';

/**
 * phase-timeline/LogEntryRow
 *
 * One fixed-height row inside a PhaseLogViewer's virtualized list. Reuses
 * the app-wide log icon/colour mapping (simple-log-entry) so a phase-timeline
 * row looks identical to the flat ExecutionLogViewer's rows.
 */

import React from 'react';
import { getLogEntryIcon } from '../simple-log-entry/log-entry-icons';
import { getLogCategoryStyles } from '../simple-log-entry/log-entry-styles';
import type { UserFriendlyLogEntry } from '../../utils/log-pattern-rules';

/** Fixed row height (px) — must match the value passed to react-window's FixedSizeList itemSize. */
export const LOG_ENTRY_ROW_HEIGHT = 26;

export interface LogEntryRowProps {
  entry: UserFriendlyLogEntry;
  style?: React.CSSProperties;
}

/**
 * @param entry - Classified log entry to render / 分類済みログエントリ
 * @param style - Positioning style injected by react-window / react-window が注入する配置スタイル
 */
export function LogEntryRow({ entry, style }: LogEntryRowProps) {
  const s = getLogCategoryStyles(entry.category);
  const Icon = getLogEntryIcon(entry.iconName);
  return (
    <div
      role="listitem"
      style={style}
      className={`flex min-w-0 items-center gap-2 px-3 text-xs ${s.row}`}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${s.icon}`} />
      <span className={`min-w-0 flex-1 truncate ${s.text}`} title={entry.message}>
        {entry.message}
      </span>
    </div>
  );
}
