/**
 * plan-declared-files
 *
 * Extracts the file paths a plan.md DECLARES it will change — the backtick
 * tokens inside its 変更予定ファイル-style section(s) — so callers can judge a
 * plan by what it commits to touch rather than by every path it mentions.
 * It is NOT a scope matcher (see scope-check.ts, which deliberately scans the
 * whole plan and adds parent directories). Pure functions only — no I/O.
 */

/**
 * Heading words that mark a plan's changed-files section. Single source of
 * truth: phase-output-validator.ts requires one of these headings in plan.md,
 * so a plan that passed validation always yields a section here.
 */
export const PLAN_FILES_SECTION_HEADINGS: readonly string[] = [
  '変更予定ファイル',
  '変更ファイル',
  '対象ファイル',
  '実装ファイル',
  'ファイル計画',
];

/**
 * A heading that NAMES the section words but declares non-goals — 「非対象
 * ファイル」 contains 「対象ファイル」 verbatim, and listing a schema file under
 * it means the opposite of changing it.
 */
const NON_GOAL_HEADING_RE = /(非対象|対象外|やらない|触らない|変更しない)/;

/** Markdown heading line: `#`-run, then the (possibly decorated) title. */
const HEADING_RE = /^(#{1,4})\s+(.*)$/;

/** Decoration stripped from a heading title before the vocabulary match. */
const HEADING_DECOR_RE = /[*_`~]|^\s*(?:\d+[.)]|[-–—・■●▶])\s*/g;

// NOTE: Same shapes as scope-check.ts PATHISH_RE / DIRISH_RE. Copied, not
// imported — services/workflow must not depend on services/agents/verification.
// The extension is lower-case only (scope-check accepts any case): a declared
// file is `core.prisma` / `TaskCard.tsx`, while `Task.fooBar` in a table cell
// is a model field, not a file.
/** File-like token: dotted extension at the end (with or without dir segments). */
const PATHISH_RE = /^[\w.@-]+(?:[/\\][\w.@[\]-]+)*\.[a-z]{1,6}$/;
/** Directory-like token: one or more path segments ending in a slash. */
const DIRISH_RE = /^[\w.@-]+(?:[/\\][\w.@-]+)*[/\\]$/;

const FENCED_BLOCK_RE = new RegExp('```[\\s\\S]*?```', 'g');

/** Whether a heading title (decoration removed) opens a changed-files section. */
function isDeclarationHeading(title: string): boolean {
  const plain = title.replace(HEADING_DECOR_RE, '').trim();
  if (!PLAN_FILES_SECTION_HEADINGS.some((h) => plain.includes(h))) return false;
  return !NON_GOAL_HEADING_RE.test(plain);
}

/** Normalize one backtick token to a path, or null when it is not path-like. */
function toPathToken(raw: string): string | null {
  const token = raw
    .trim()
    .replace(/:(\d+)(:\d+)?$/, '')
    .replace(/\\/g, '/');
  // A token with whitespace is a command or sentence (`bun test a/b.ts`), not
  // a declaration of a file to change.
  if (!token || /\s/.test(token)) return null;
  return PATHISH_RE.test(token) || DIRISH_RE.test(token) ? token : null;
}

/**
 * Collect the paths a plan declares it will change.
 *
 * A declaration section starts at a `#`–`####` heading whose title contains one
 * of PLAN_FILES_SECTION_HEADINGS (and no non-goal word), and ends at the next
 * heading of the same or a shallower level — deeper sub-headings such as
 * `### 新規作成` / `### 変更予定` stay inside. Every matching section is scanned
 * and the union returned. Fenced code blocks are ignored.
 *
 * @param planContent - plan.md text. / plan.md の内容
 * @returns Unique normalized (forward-slash) paths and directory tokens; [] when
 *   no declaration section or no path-like token exists. / 宣言パス一覧（節なし・0件は空配列）
 */
export function extractPlanDeclaredFiles(planContent: string | null | undefined): string[] {
  const out = new Set<string>();
  if (!planContent) return [];
  const lines = planContent.replace(FENCED_BLOCK_RE, '').split(/\r?\n/);
  let sectionLevel = 0; // 0 = outside any declaration section
  for (const line of lines) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (sectionLevel > 0 && level <= sectionLevel) sectionLevel = 0;
      if (sectionLevel === 0 && isDeclarationHeading(heading[2])) sectionLevel = level;
      continue;
    }
    if (sectionLevel === 0) continue;
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const token = toPathToken(m[1]);
      if (token) out.add(token);
    }
  }
  return [...out];
}
