'use client';

/**
 * verdict-chip
 *
 * Renders a markdown line/paragraph whose entire content is one of verify.md's
 * machine verdict phrases (✅ 検証成功 / ❌ Fail / …) as a compact status pill so
 * a report's verdict reads at a glance. Detection is display-only — the stored
 * markdown and its machine-parsed vocabulary are never modified.
 */

import type { ReactNode } from 'react';
import { Check, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { flattenNodeText, renderTextWithEmojiIcons } from './emoji-to-lucide';

type VerdictTone = 'pass' | 'fail' | 'partial';

// Design language: tinted bg + border + text per tone, borders not shadows,
// readable in both themes.
const TONE_STYLES: Record<VerdictTone, { Icon: LucideIcon; className: string }> = {
  pass: {
    Icon: Check,
    className:
      'border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300',
  },
  fail: {
    Icon: X,
    className:
      'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300',
  },
  partial: {
    Icon: TriangleAlert,
    className:
      'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300',
  },
};

// The exact machine-parsed verdict phrases (ja + en), optionally followed by a
// short parenthesised qualifier such as （修正不要） / (no change needed).
// Anchored: the whole line must be the phrase — "結果: ✅ Pass" is NOT a chip.
// The invisible char after the group is the variation selector U+FE0F (⚠️ form).
const VERDICT_RE =
  /^(✅|❌|⚠)️?\s*(検証成功|検証失敗|一部失敗|Pass|Fail|Partial)(\s*[（(][^（）()]{1,60}[）)])?$/;

const TONE_BY_EMOJI: Record<string, VerdictTone> = {
  '✅': 'pass',
  '❌': 'fail',
  '⚠': 'partial',
};

// NOTE: the chip DISPLAYS a short label; the full machine-parsed canonical
// phrase stays available on the chip's title (hover) — the stored markdown is
// of course untouched.
const SHORT_LABELS: Record<string, string> = {
  検証成功: '合格',
  検証失敗: '不合格',
  一部失敗: '一部失敗',
  Pass: 'Pass',
  Fail: 'Fail',
  Partial: 'Partial',
};

interface VerdictChipProps {
  /** Verdict tone driving colour and icon. / 判定トーン */
  tone: VerdictTone;
  /** Short label displayed inside the pill. / ピル内に表示する短い文言 */
  text: string;
  /** Full canonical phrase, shown as the hover title. / ホバー表示用の正式文言 */
  fullText?: string;
}

/**
 * Compact status pill for a whole-line verdict phrase.
 *
 * @param tone - Verdict tone (pass/fail/partial). / 判定トーン
 * @param text - Short label displayed inside the pill. / ピル内の短い表示文言
 * @param fullText - Full canonical phrase for the title attribute. / title用の正式文言
 * @returns The pill element. / ピル要素
 */
export function VerdictChip({ tone, text, fullText }: VerdictChipProps) {
  const { Icon, className } = TONE_STYLES[tone];
  return (
    <span
      title={fullText}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {text}
    </span>
  );
}

/**
 * Block-level markdown children renderer: a line that IS a verdict phrase
 * (optionally bold-wrapped) becomes a status chip; anything else falls back to
 * inline emoji→icon substitution. Use in `p` / `li` component overrides.
 *
 * @param node - Children of a block-level override. / ブロック要素の子ノード
 * @returns Chip, or emoji-substituted children. / チップまたは置換済み子ノード
 */
export function renderBlockWithEmojiIcons(node: ReactNode): ReactNode {
  const m = VERDICT_RE.exec(flattenNodeText(node).trim());
  if (m) {
    const tone = TONE_BY_EMOJI[m[1]];
    if (tone) {
      const qualifier = (m[3] ?? '').trim();
      // Full-width parens need no separating space; ASCII parens keep one.
      const sep = qualifier && !qualifier.startsWith('（') ? ' ' : '';
      const full = `${m[2]}${sep}${qualifier}`;
      const display = `${SHORT_LABELS[m[2]] ?? m[2]}${sep}${qualifier}`;
      return <VerdictChip tone={tone} text={display} fullText={full} />;
    }
  }
  return renderTextWithEmojiIcons(node);
}
