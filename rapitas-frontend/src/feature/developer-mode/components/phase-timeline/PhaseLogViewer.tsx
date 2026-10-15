'use client';

/**
 * phase-timeline/PhaseLogViewer
 *
 * Virtualized log list for one phase-timeline section (task #785). Uses
 * react-window's FixedSizeList so a 5000+ line iteration only mounts the
 * rows currently in view — a collapsed section renders nothing at all
 * (the parent PhaseSection doesn't mount this component when collapsed).
 */

import React from 'react';
import { useTranslations } from 'next-intl';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import { LogEntryRow, LOG_ENTRY_ROW_HEIGHT } from './LogEntryRow';
import type { UserFriendlyLogEntry } from '../../utils/log-pattern-rules';

const MAX_HEIGHT = 300;
const OVERSCAN = 5;

export interface PhaseLogViewerProps {
  entries: UserFriendlyLogEntry[];
  /** Ref to the scrollable outer element — usePhaseLogStreaming reads/writes scroll position through it. */
  outerRef?: React.Ref<HTMLDivElement>;
  onScroll?: () => void;
}

function Row({ index, style, data }: ListChildComponentProps<UserFriendlyLogEntry[]>) {
  return <LogEntryRow entry={data[index]} style={style} />;
}

/**
 * @param entries - Already-filtered, classified log entries for this iteration / 表示対象のログエントリ
 * @param outerRef - Forwarded to react-window's scrollable outer div / スクロール要素への ref
 * @param onScroll - Fired on the outer scroll container's scroll event / スクロールイベントハンドラ
 */
export function PhaseLogViewer({ entries, outerRef, onScroll }: PhaseLogViewerProps) {
  const t = useTranslations('phaseTimeline');

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center px-3 py-6 text-xs text-zinc-500">
        {t('noLogsYet')}
      </div>
    );
  }

  const height = Math.min(MAX_HEIGHT, entries.length * LOG_ENTRY_ROW_HEIGHT);

  return (
    <FixedSizeList
      height={height}
      width="100%"
      itemCount={entries.length}
      itemSize={LOG_ENTRY_ROW_HEIGHT}
      itemData={entries}
      overscanCount={OVERSCAN}
      outerRef={outerRef}
      onScroll={onScroll}
    >
      {Row}
    </FixedSizeList>
  );
}
