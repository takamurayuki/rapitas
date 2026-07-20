'use client';

/**
 * simple-log-entry/simple-log-entry
 *
 * Friendly log renderer built around a narrative-first hierarchy: the agent's
 * own reasoning prose is prominent and readable, while mechanical entries
 * (tool calls, system events) are compact single-line truncated rows.
 * No emoji — visual cues come from lucide icons and quiet colour coding.
 */

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, Loader } from 'lucide-react';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import type { UserFriendlyLogEntry } from '../../utils/log-pattern-rules';
import { getLogEntryIcon } from './log-entry-icons';
import { getLogCategoryStyles } from './log-entry-styles';
import {
  CopyButton,
  CountBadge,
  NarrativeRow,
  PhaseEntry,
  ToolResultRow,
  hl,
} from './log-entry-rows';
import type { HighlightProps } from './log-entry-rows';

interface SimpleLogEntryProps extends HighlightProps {
  entry: UserFriendlyLogEntry;
  index: number;
  isNewEntry?: boolean;
  /** Whether this is the last entry in the current log. / 現在ログの最後のエントリか */
  isLastEntry?: boolean;
}

// Compact scale for the shared MarkdownView inside the terminal-style log:
// tight heading sizes/margins and dense list/paragraph rhythm so the preview
// reads like a formatted panel, not a document. `!` wins over the renderer's
// own important spacing (`.wrapper h2` outranks the element's utility class).
const COMPACT_MD_CLASS = [
  '[&_h1]:!text-sm [&_h1]:!mt-0 [&_h1]:!mb-2 [&_h1]:!pb-1',
  '[&_h2]:!text-sm [&_h2]:!mt-3 [&_h2]:!mb-1.5 [&_h2]:!pb-1 [&_h2]:before:!h-3.5',
  '[&_h3]:!text-xs [&_h3]:!mt-2.5 [&_h3]:!mb-1',
  '[&_h4]:!text-xs [&_h4]:!mt-2 [&_h4]:!mb-1',
  '[&_p]:!my-1.5 [&_p]:!text-xs [&_li]:!text-xs',
  '[&_ul]:!my-1 [&_ol]:!my-1 [&_li]:!my-0.5',
  '[&_pre]:!my-2 [&_pre]:!p-2 [&_pre]:!bg-zinc-950 [&_pre]:!text-[11px]',
  '[&_table]:!my-2 [&_hr]:!my-3 [&_blockquote]:!my-2 [&_blockquote]:!py-1',
].join(' ');

/**
 * Renders one classified log entry. Narrative (agent-text) entries get the
 * prominent multi-line treatment; phase transitions render as divider chips;
 * everything mechanical is a compact single-line truncated row with
 * click-to-expand detail and a ×N badge for merged duplicates.
 *
 * @param entry - Classified log entry. / 分類済みログエントリ
 * @param index - Row index. / 行インデックス
 * @param isNewEntry - Whether to play the appear animation. / 出現アニメーションを再生するか
 * @param isLastEntry - Whether this is the last entry in the log. / 最後のエントリか
 * @param searchQuery - Active search query. / 検索クエリ
 * @param highlightText - Match highlighter from the viewer. / 検索ハイライト関数
 */
export const SimpleLogEntry: React.FC<SimpleLogEntryProps> = ({
  entry,
  index,
  isNewEntry = false,
  isLastEntry = false,
  searchQuery,
  highlightText,
}) => {
  const t = useTranslations('devMode.simpleLogEntry');
  const [showDetail, setShowDetail] = useState(false);
  const hp: HighlightProps = { searchQuery, highlightText };

  if (entry.category === 'phase-transition')
    return <PhaseEntry entry={entry} isNew={isNewEntry} {...hp} />;
  if (entry.category === 'tool-result') return <ToolResultRow entry={entry} {...hp} />;
  if (entry.category === 'agent-text')
    return <NarrativeRow entry={entry} isNew={isNewEntry} {...hp} />;

  const s = getLogCategoryStyles(entry.category);
  const hasDetail = !!entry.detail;

  return (
    <div
      key={index}
      className={s.row}
      style={{ animation: isNewEntry ? 'fadeInSlide 0.3s ease-out' : undefined }}
    >
      <div
        className={`flex min-w-0 items-center gap-2 px-3 py-1 ${hasDetail ? 'cursor-pointer' : ''}`}
        onClick={() => hasDetail && setShowDetail((v) => !v)}
      >
        {React.createElement(getLogEntryIcon(entry.iconName), {
          className: `w-3.5 h-3.5 shrink-0 ${s.icon}`,
        })}
        <span className={`min-w-0 flex-1 truncate text-xs ${s.text}`} title={entry.message}>
          {hl(entry.message, hp)}
        </span>
        {(entry.count ?? 1) > 1 && <CountBadge count={entry.count!} />}
        {entry.copyText && <CopyButton text={entry.copyText} />}
        {hasDetail && (
          <span
            className="shrink-0 text-zinc-600"
            aria-label={showDetail ? t('close') : t('fullText')}
          >
            {showDetail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </span>
        )}
        {/* NOTE: gated on isLastEntry — this entry (e.g. "思考中…") signals why
            NOTHING is showing right now. Once any later entry appears, showing
            the pulse here forever would misrepresent stale history as active. */}
        {entry.category === 'progress' && isLastEntry && (
          <div className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-400" />
        )}
      </div>
      {hasDetail &&
        showDetail &&
        (entry.detailFormat === 'markdown' ? (
          // Formatted preview via the shared renderer. The scoped `dark` class
          // forces the renderer's dark palette (the app's dark variant is
          // class-based) so the preview stays terminal-native in both themes.
          <div className="dark mx-3 mb-1.5 ml-8 max-h-96 overflow-y-auto rounded border border-zinc-700/60 bg-zinc-900 p-3">
            <MarkdownView content={entry.detail!} className={COMPACT_MD_CLASS} />
          </div>
        ) : (
          <pre className="mx-3 mb-1.5 ml-8 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded bg-zinc-950/60 p-2 text-xs text-zinc-400">
            {hl(entry.detail!, hp)}
          </pre>
        ))}
    </div>
  );
};

/**
 * Renders a list of simple log entries.
 */
export const SimpleLogEntryList: React.FC<
  {
    entries: UserFriendlyLogEntry[];
    newEntriesCount?: number;
  } & HighlightProps
> = ({ entries, newEntriesCount = 0, searchQuery, highlightText }) => {
  const t = useTranslations('devMode.simpleLogEntry');
  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-500">
        <div className="text-center">
          <Loader className="mx-auto mb-2 h-6 w-6 animate-spin text-zinc-600" />
          <p className="text-sm">{t('waitingForLogs')}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {entries.map((entry, i) => (
        <SimpleLogEntry
          key={i}
          entry={entry}
          index={i}
          isNewEntry={i >= entries.length - newEntriesCount}
          isLastEntry={i === entries.length - 1}
          searchQuery={searchQuery}
          highlightText={highlightText}
        />
      ))}
    </div>
  );
};

export default SimpleLogEntry;
