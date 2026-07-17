'use client';

/**
 * emoji-to-lucide
 *
 * Display-side substitution of a small fixed set of status emoji (✅ ❌ ⚠️ ℹ️ 💡
 * 📝 ⏳) with inline lucide-react icons when rendering agent-generated markdown,
 * plus collapsing of redundant status words that merely restate the icon
 * ("✅ 完了: x" renders as icon + "x"). Pure display concern — it never rewrites
 * the stored markdown, so the machine-parsed verdict vocabulary stays intact.
 */

import { Fragment, type ReactNode } from 'react';
import { Check, Clock, FileText, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';

interface EmojiIconEntry {
  /** lucide component that replaces the emoji. */
  Icon: LucideIcon;
  /** Colour utility classes readable on both light and dark themes. */
  className: string;
  /** Accessible meaning of the original emoji (used as the default aria-label). */
  label: string;
  /**
   * Matches a directly-following word that restates the icon's meaning
   * ("完了", "Done", …) so it can collapse into the icon (display only).
   */
  collapseRe?: RegExp;
}

/**
 * Builds the collapse matcher for one icon family. The word must be followed by
 * a colon (consumed) or by whitespace/end (kept) — this boundary keeps
 * "✅ 完了しました" or "✅ Passing" intact while collapsing "✅ 完了:" / "✅ Done".
 *
 * @param words - Redundant synonyms, longest variants first. / 冗長な同義語（長い順）
 * @returns Anchored matcher whose group 1 is the collapsed word. / 折り畳む語を捕捉する正規表現
 */
function buildCollapseRe(words: readonly string[]): RegExp {
  return new RegExp(`^[ \\t]*(${words.join('|')})(?:[:：]|(?=\\s|$))`);
}

const CHECK_WORDS = ['完了', '成功', '合格', 'OK', 'Done', 'Passed', 'Pass'] as const;
const FAIL_WORDS = ['失敗', '未完了', '未実施', 'NG', 'Failed', 'Fail'] as const;
const WARN_WORDS = ['警告', '注意', 'Warning'] as const;

// NOTE: 💡 maps to Info, NOT Lightbulb — ICON_POLICY reserves Lightbulb for the
// idea-box feature; in agent reports 💡 means "hint". Keys are emoji BASE
// characters: the variation selector (U+FE0F) is stripped by the split regex,
// so ✔️ and ✔ both resolve to the '✔' entry.
const EMOJI_ICON_MAP: Record<string, EmojiIconEntry> = {
  '✅': {
    Icon: Check,
    className: 'text-green-500',
    label: 'success',
    collapseRe: buildCollapseRe(CHECK_WORDS),
  },
  '✔': {
    Icon: Check,
    className: 'text-green-500',
    label: 'success',
    collapseRe: buildCollapseRe(CHECK_WORDS),
  },
  '❌': {
    Icon: X,
    className: 'text-red-500',
    label: 'failure',
    collapseRe: buildCollapseRe(FAIL_WORDS),
  },
  '✖': {
    Icon: X,
    className: 'text-red-500',
    label: 'failure',
    collapseRe: buildCollapseRe(FAIL_WORDS),
  },
  '⚠': {
    Icon: TriangleAlert,
    className: 'text-amber-500',
    label: 'warning',
    collapseRe: buildCollapseRe(WARN_WORDS),
  },
  ℹ: { Icon: Info, className: 'text-sky-500', label: 'info' },
  '💡': { Icon: Info, className: 'text-sky-500', label: 'hint' },
  '📝': { Icon: FileText, className: 'text-zinc-400', label: 'note' },
  '⏳': { Icon: Clock, className: 'text-zinc-400', label: 'pending' },
};

const EMOJI_ALTERNATION = Object.keys(EMOJI_ICON_MAP).join('|');
// Capture only the base character; the optional variation selector outside the
// group is swallowed by String.split, which normalises ✔️/✔ to one map key.
const EMOJI_SPLIT_RE = new RegExp(`(${EMOJI_ALTERNATION})\\uFE0F?`, 'g');
const EMOJI_TEST_RE = new RegExp(EMOJI_ALTERNATION);

interface EmojiIconProps {
  /** Emoji base character (map key). / 絵文字の基底文字 */
  emoji: string;
  /** Collapsed redundant word shown as the accessible label instead. / 折り畳んだ語 */
  collapsedLabel?: string;
}

/**
 * Inline lucide replacement for one mapped status emoji.
 *
 * @param emoji - Emoji base character to render. / 描画する絵文字の基底文字
 * @param collapsedLabel - Redundant word collapsed into the icon, if any. / アイコンへ折り畳まれた語
 * @returns The lucide icon, or the raw emoji text when unmapped. / lucideアイコン（未対応時は原文）
 */
export function EmojiIcon({ emoji, collapsedLabel }: EmojiIconProps) {
  const entry = EMOJI_ICON_MAP[emoji];
  if (!entry) return <>{emoji}</>;
  const { Icon, className, label } = entry;
  return (
    <Icon
      role="img"
      aria-label={collapsedLabel ?? label}
      className={`inline-block h-[1em] w-[1em] align-[-0.125em] ${className}`}
    />
  );
}

/**
 * Substitutes mapped emoji in one string, collapsing redundant status words
 * that immediately follow a status icon into the icon's aria-label.
 *
 * @param text - Raw text node content. / 対象テキスト
 * @returns Mixed array of strings and icon elements. / 文字列とアイコンの混在配列
 */
function substituteString(text: string): ReactNode {
  if (!EMOJI_TEST_RE.test(text)) return text;
  const parts = text.split(EMOJI_SPLIT_RE);
  const out: ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) out.push(parts[i]);
      continue;
    }
    const emoji = parts[i];
    const collapseRe = EMOJI_ICON_MAP[emoji]?.collapseRe;
    let collapsedLabel: string | undefined;
    const next = parts[i + 1];
    if (collapseRe && typeof next === 'string') {
      const m = collapseRe.exec(next);
      if (m) {
        collapsedLabel = m[1];
        parts[i + 1] = next.slice(m[0].length);
      }
    }
    out.push(<EmojiIcon key={i} emoji={emoji} collapsedLabel={collapsedLabel} />);
  }
  return out;
}

/**
 * Replaces mapped emoji inside markdown TEXT children with inline lucide icons.
 * Non-string children (nested elements) pass through untouched — their own
 * component overrides handle their text. Unknown emoji render unchanged.
 *
 * @param node - Children of a react-markdown component override. / 置換対象の子ノード
 * @returns Children with emoji swapped for icons. / 絵文字をアイコン化した子ノード
 */
export function renderTextWithEmojiIcons(node: ReactNode): ReactNode {
  if (typeof node === 'string') return substituteString(node);
  if (Array.isArray(node)) {
    return node.map((child, i) => (
      <Fragment key={i}>{typeof child === 'string' ? substituteString(child) : child}</Fragment>
    ));
  }
  return node;
}
