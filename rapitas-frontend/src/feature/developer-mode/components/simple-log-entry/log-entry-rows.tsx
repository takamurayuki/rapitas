'use client';

/**
 * simple-log-entry/log-entry-rows
 *
 * Specialised row renderers for the friendly log: phase-transition chips,
 * quiet tool-result lines, and the prominent narrative (agent reasoning) row.
 * The standard mechanical row lives in simple-log-entry.tsx.
 */

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bot, Check, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import type { UserFriendlyLogEntry } from '../../utils/log-pattern-rules';
import { getLogEntryIcon } from './log-entry-icons';
import { PHASE_CHIP_COLORS } from './log-entry-styles';

/** Optional search highlighting threaded from the viewer into each entry. */
export interface HighlightProps {
  searchQuery?: string;
  highlightText?: (text: string, query: string) => React.ReactNode;
}

/** Render `text`, wrapping the active search match when highlighting is enabled. */
export function hl(text: string, hp: HighlightProps): React.ReactNode {
  return hp.searchQuery && hp.highlightText ? hp.highlightText(text, hp.searchQuery) : text;
}

/** ×N badge for entries merged from consecutive identical lines. */
export const CountBadge: React.FC<{ count: number }> = ({ count }) => {
  const t = useTranslations('devMode.simpleLogEntry');
  return (
    <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-px text-[10px] font-medium text-zinc-400">
      {t('repeatCount', { count })}
    </span>
  );
};

/** Copy-to-clipboard button shown at a row's right edge (Copy → Check feedback). */
export const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const t = useTranslations('devMode.simpleLogEntry');
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="shrink-0 rounded p-0.5 text-zinc-500 hover:text-zinc-300 focus-visible:ring-2 focus-visible:ring-indigo-500"
      aria-label={copied ? t('copied') : t('copyPath')}
      title={copied ? t('copied') : t('copyPath')}
    >
      {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
};

// ── Phase transition ───────────────────────────────────

export const PhaseEntry: React.FC<
  { entry: UserFriendlyLogEntry; isNew: boolean } & HighlightProps
> = ({ entry, isNew, ...hp }) => {
  // NOTE: original palette kept — no-phase lifecycle chips (execution start,
  // provider start) use the research blue, per user feedback.
  const color = (entry.phase && PHASE_CHIP_COLORS[entry.phase]) || PHASE_CHIP_COLORS.research;
  return (
    <div className="my-2" style={{ animation: isNew ? 'fadeInSlide 0.3s ease-out' : undefined }}>
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-zinc-700/60" />
        <div
          className={`flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${color}`}
        >
          {React.createElement(getLogEntryIcon(entry.iconName), {
            className: 'w-3.5 h-3.5 shrink-0',
          })}
          <span className="truncate" title={entry.message}>
            {hl(entry.message, hp)}
          </span>
        </div>
        <div className="h-px flex-1 bg-zinc-700/60" />
      </div>
    </div>
  );
};

// ── Tool result (inline, quietest) ─────────────────────

export const ToolResultRow: React.FC<{ entry: UserFriendlyLogEntry } & HighlightProps> = ({
  entry,
  ...hp
}) => (
  <div className="flex min-w-0 items-center gap-1.5 py-px pl-8 pr-3 text-xs text-zinc-600">
    {React.createElement(getLogEntryIcon(entry.iconName ?? 'Check'), {
      className: 'w-3 h-3 shrink-0',
    })}
    <span className="min-w-0 flex-1 truncate" title={entry.message}>
      {hl(entry.message, hp)}
    </span>
    {(entry.count ?? 1) > 1 && <CountBadge count={entry.count!} />}
  </div>
);

// ── Narrative (agent reasoning) — the star of the log ──

export const NarrativeRow: React.FC<
  { entry: UserFriendlyLogEntry; isNew: boolean } & HighlightProps
> = ({ entry, isNew, ...hp }) => {
  const t = useTranslations('devMode.simpleLogEntry');
  const [open, setOpen] = useState(false);
  const fullText = entry.detail && entry.detail !== entry.message ? entry.detail : undefined;
  // Expand also when the preview itself likely clamps past three lines.
  const canExpand =
    !!fullText || entry.message.length > 220 || (entry.message.match(/\n/g)?.length ?? 0) >= 3;

  return (
    <div
      className="px-3 py-1.5"
      style={{ animation: isNew ? 'fadeInSlide 0.3s ease-out' : undefined }}
    >
      <div className="flex items-start gap-2">
        {/* NOTE: Bot = the agent speaking its own reasoning (user decision);
            MessageSquare is reserved for instructions sent TO the agent. */}
        <Bot className="mt-1.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
        {/* Speech bubble (user request): the robot "talks" — chat-style bubble
            with a small tail pointing at the Bot glyph. Same text size as
            mechanical rows; the bubble carries the differentiation, not scale. */}
        <div className="relative min-w-0 flex-1 rounded-lg rounded-tl-sm border border-zinc-700 bg-zinc-800/70 px-2.5 py-1.5">
          <span
            aria-hidden="true"
            className="absolute -left-[5px] top-2 h-2.5 w-2.5 rotate-45 border-b border-l border-zinc-700 bg-zinc-800"
          />
          <p
            className={`whitespace-pre-line break-words text-xs leading-relaxed text-zinc-200 ${
              open ? '' : 'line-clamp-3'
            }`}
          >
            {hl(open && fullText ? fullText : entry.message, hp)}
          </p>
          {canExpand && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="mt-0.5 flex items-center gap-0.5 text-xs text-zinc-500 hover:text-zinc-300"
            >
              {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {open ? t('close') : t('fullText')}
            </button>
          )}
        </div>
        {(entry.count ?? 1) > 1 && <CountBadge count={entry.count!} />}
      </div>
    </div>
  );
};
