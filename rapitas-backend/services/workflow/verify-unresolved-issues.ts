/**
 * verify-unresolved-issues
 *
 * Extracts the 残課題 / フォローアップ items from a verify.md and compares two
 * consecutive rounds, so a repair loop whose unresolved list never changes can
 * be cut off. Pure and DB-free; wiring lives in verify-self-repair-budget.ts.
 * NOT a replacement for stripNonEvidenceRegions — that exclusion stays so the
 * honesty gate keeps ignoring this section (task 504); we read it separately.
 */
import { isSameFinding } from './verify-evidence-similarity';

const HEADING_RE =
  /^#{1,4}\s*(?:残課題|フォローアップ|未解決|follow-?ups?|open items|remaining)[^\n]*$/i;
const ANY_HEADING_RE = /^#{1,4}\s/;
const EMPTY_DECLARATIONS = new Set([
  'なし',
  'ない',
  'none',
  'n/a',
  'na',
  '-',
  '–',
  '—',
  'nil',
  '無し',
]);

/** Rounds of identical unresolved issues that trigger the cutoff. */
export const UNCHANGED_UNRESOLVED_THRESHOLD_ROUNDS = 2;

/** Result of comparing two rounds' unresolved issues. */
export interface UnresolvedComparison {
  /** True only when both rounds list the same non-empty set. */
  unchanged: boolean;
  /** The (normalized) items that did not change; empty when `unchanged` is false. */
  items: string[];
}

function normalizeItem(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '')
    .replace(/^\s*\[[ xX]\]\s*/, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Extract normalized unresolved-issue items from a verify.md body.
 *
 * @param verifyContent - verify.md body / verify.md 本文
 * @returns Normalized items in document order; [] when the section is absent or empty / 残課題項目
 */
export function extractUnresolvedIssues(verifyContent: string): string[] {
  // Feedback blocks quote past reasons and may contain this heading themselves.
  const text = verifyContent.replace(
    /<!--\s*repair-feedback:start\s*-->[\s\S]*?<!--\s*repair-feedback:end\s*-->/gi,
    '',
  );
  const items: string[] = [];
  let inSection = false;
  let sectionLevel = 0;
  for (const line of text.split(/\r?\n/)) {
    if (HEADING_RE.test(line.trim())) {
      inSection = true;
      sectionLevel = (line.trim().match(/^#+/) ?? ['#'])[0].length;
      continue;
    }
    if (!inSection) continue;
    const trimmed = line.trim();
    if (ANY_HEADING_RE.test(trimmed)) {
      const level = (trimmed.match(/^#+/) ?? ['#'])[0].length;
      if (level <= sectionLevel) {
        inSection = false;
        continue;
      }
    }
    if (!trimmed || ANY_HEADING_RE.test(trimmed) || trimmed.startsWith('>')) continue;
    if (/^\|?[\s:|-]+\|?$/.test(trimmed) && trimmed.includes('-')) continue; // table separator
    const item = normalizeItem(trimmed);
    if (!item || EMPTY_DECLARATIONS.has(item.replace(/[。.]$/, ''))) continue;
    items.push(item);
  }
  // Table header row (first row before a separator) is noise; drop it.
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (/^\|?\s*:?-{2,}[\s:|-]*$/.test(lines[i].trim()) && lines[i - 1].trim().startsWith('|')) {
      const h = normalizeItem(lines[i - 1].trim());
      const idx = items.indexOf(h);
      if (idx >= 0) items.splice(idx, 1);
    }
  }
  return items;
}

/**
 * Compare the previous and current round's unresolved issues.
 *
 * @param previous - Previous verify.md (null when unavailable) / 前周 verify.md
 * @param current - Current verify.md / 今周 verify.md
 * @returns unchanged=true only when both sets are non-empty and identical / 変化の有無
 */
export function compareUnresolvedIssues(
  previous: string | null | undefined,
  current: string,
): UnresolvedComparison {
  if (!previous) return { unchanged: false, items: [] };
  const prev = extractUnresolvedIssues(previous);
  const cur = extractUnresolvedIssues(current);
  if (prev.length === 0 || cur.length === 0) return { unchanged: false, items: [] };
  // Bidirectional so an added or removed item is never read as "unchanged".
  const covered = (xs: string[], ys: string[]) =>
    xs.every((x) => ys.some((y) => isSameFinding(x, y)));
  if (!covered(cur, prev) || !covered(prev, cur)) return { unchanged: false, items: [] };
  return { unchanged: true, items: cur };
}

/**
 * Build the escalation detail naming the unresolved issues that did not change.
 *
 * @param items - Unchanged items / 変化していない残課題
 * @returns Detail text / 打ち切り理由
 */
export function buildUnchangedUnresolvedDetail(items: string[]): string {
  const shown = items
    .slice(0, 5)
    .map((i) => `「${i}」`)
    .join('、');
  return `verify.md の残課題が${UNCHANGED_UNRESOLVED_THRESHOLD_ROUNDS}周続けて同一です（変化していない残課題: ${shown}）。実装者では解消できない課題の可能性が高く、計画または仕様の見直しが必要です。`;
}
