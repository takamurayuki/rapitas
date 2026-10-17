/**
 * screen-task-plan
 *
 * Turns a generated project's `# 画面一覧` into one task spec per screen, and
 * attributes each `# 画面導線` line to the screen it names.
 * Not responsible for creating tasks or reading files — callers own both, so
 * the parse stays pure and testable.
 */

import { matchFeatureLine, sectionLines } from './requirements-task-plan';

/** The section that declares the screens. */
export const SCREEN_SECTION = '画面一覧';

/** One screen, ready to become a task. */
export interface ScreenTaskSpec {
  /** Screen name as written, e.g. `ログイン`. This is its identity. */
  name: string;
  /** Route when the document gives one, e.g. `/login`. */
  route?: string;
  /** Purpose, UI elements and transitions, verbatim. */
  detail: string;
  /** Features whose 画面導線 lands on this screen, in document order. */
  featureIds: string[];
}

/**
 * A bullet declaring a screen.
 *
 * Accepts the wrappers the generator actually emits, for the same reason
 * `FEATURE_DECLARATION` does: a shape rejected here costs the project every
 * screen task and reports nothing.
 * - `- ログイン: メール` — TempoRaid's live shape.
 * - `- **ログイン**：メール` — bold wrapper, full-width colon.
 * - `- [ ] 設定: 音量` — written as a checklist.
 * - `- [S-03] ロビー: ドロップゾーン` — carrying an id the document assigned.
 *
 * Group 1 is the name, group 2 the remaining text.
 */
const SCREEN_BULLET =
  /^[ \t]*[-*+][ \t]+(?:\[[ xX]\][ \t]+)?(?:[[［][ \t]*S-\d+[ \t]*[\]］][ \t]*)?\*{0,2}[ \t]*([^:：*]+?)[ \t]*\*{0,2}[ \t]*(?:[:：][ \t]*(.*))?$/;

/** A markdown table row, split into trimmed cells. */
function tableCells(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  return t
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/** Whether a row is the `|---|---|` separator rather than data. */
function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/** Strip bold and backticks so a name matches the one used elsewhere. */
function cleanName(raw: string): string {
  return raw
    .replace(/^\*{1,2}|\*{1,2}$/g, '')
    .replace(/`/g, '')
    .trim();
}

/**
 * Screens declared as a markdown table.
 *
 * ContextFlow's shape: a 画面名 column, usually a ルート column, then free
 * columns. Column positions are read from the header rather than assumed,
 * because the generator orders them differently per project.
 *
 * @param lines - The section's lines / セクションの行
 * @returns Screens, or [] when the section is not a table / 表でなければ []
 */
function parseTableScreens(lines: readonly string[]): Omit<ScreenTaskSpec, 'featureIds'>[] {
  const rows = lines.map(tableCells).filter((c): c is string[] => c !== null);
  if (rows.length < 2) return [];

  const header = rows[0];
  const nameAt = header.findIndex((h) => h.includes('画面'));
  if (nameAt < 0) return [];
  const routeAt = header.findIndex((h) => /ルート|route|パス|URL/i.test(h));

  const out: Omit<ScreenTaskSpec, 'featureIds'>[] = [];
  for (const cells of rows.slice(1)) {
    if (isSeparatorRow(cells)) continue;
    const name = cleanName(cells[nameAt] ?? '');
    if (!name) continue;
    const route = routeAt >= 0 ? cleanName(cells[routeAt] ?? '') : '';
    // The name and route are carried as their own fields, so repeating them in
    // the prose would just make the task description read twice.
    const detail = cells.filter((_, i) => i !== nameAt && i !== routeAt).join(' / ');
    out.push({ name, route: route || undefined, detail });
  }
  return out;
}

/** Screens declared as a bullet list. */
function parseBulletScreens(lines: readonly string[]): Omit<ScreenTaskSpec, 'featureIds'>[] {
  const out: Omit<ScreenTaskSpec, 'featureIds'>[] = [];
  for (const line of lines) {
    const m = line.match(SCREEN_BULLET);
    if (!m) continue;
    const name = cleanName(m[1] ?? '');
    if (!name) continue;
    out.push({ name, detail: (m[2] ?? '').trim() });
  }
  return out;
}

/**
 * Feature ids whose 画面導線 line mentions the screen's name or route.
 *
 * A screen nothing routes to gets an empty list rather than a borrowed one: a
 * screen task measured against another screen's features would verify the
 * wrong thing, and an empty list is recoverable.
 *
 * @param markdown - requirements.md content / requirements.md の内容
 * @param screen - Name and optional route / 画面名とルート
 * @returns Feature ids in document order / 文書順の機能ID
 */
function featuresReaching(markdown: string, screen: { name: string; route?: string }): string[] {
  const needles = [screen.name, screen.route].filter((s): s is string => Boolean(s));
  const out: string[] = [];
  for (const line of sectionLines(markdown, '画面導線')) {
    const m = matchFeatureLine(line);
    if (!m?.text) continue;
    if (needles.some((n) => m.text.includes(n))) out.push(m.id);
  }
  return [...new Set(out)];
}

/**
 * One spec per screen declared in `# 画面一覧`.
 *
 * Identity is the NAME, never a position: inserting a screen must not shift
 * the ones after it and make every already-filed task look new.
 *
 * @param markdown - requirements.md content / requirements.md の内容
 * @returns Specs in document order, deduplicated by name / 文書順の画面仕様
 */
export function parseScreenTasks(markdown: string): ScreenTaskSpec[] {
  if (!markdown) return [];
  const lines = sectionLines(markdown, SCREEN_SECTION);
  if (lines.length === 0) return [];

  const parsed = parseTableScreens(lines);
  const screens = parsed.length > 0 ? parsed : parseBulletScreens(lines);

  const seen = new Set<string>();
  const out: ScreenTaskSpec[] = [];
  for (const s of screens) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    out.push({ ...s, featureIds: featuresReaching(markdown, s) });
  }
  return out;
}
