/**
 * acceptance-self-check
 *
 * ADVISORY pre-completion self-check: matches the task's acceptance criteria
 * (and task text) against the changed-file set so the IMPLEMENTER can detect
 * "diff addresses no criterion" (bounce class A, task 614) and "diff is
 * unrelated to the task" (task 608) BEFORE declaring completion — the two
 * classes that made up 44% of verify bounces (baseline 2026-08-16).
 * Deterministic token matching only; NOT responsible for gating (the check is
 * excluded from the hard `ok` verdict) nor for replacing adversarial review.
 */
import type { VerificationCheck } from './automated-verifier';

/** File-like token: dotted extension at the end (mirrors scope-check). */
const PATHISH_RE = /^[\w.@-]+(?:[/\\][\w.@[\]-]+)*\.[A-Za-z]{1,6}$/;
/** Directory-like token: one or more path segments ending in a slash. */
const DIRISH_RE = /^[\w.@-]+(?:[/\\][\w.@-]+)*[/\\]$/;
/**
 * Extensions accepted for BARE (non-backtick, separator-less) filename tokens.
 * PATHISH_RE alone would capture prose like "e.g" — free text is far noisier
 * than plan.md's mandated backtick format, so bare tokens need a real
 * file-extension signal before they may make a criterion "determinable"
 * (a phantom token would turn into a false zero-match NG).
 */
const KNOWN_FILE_EXT_RE =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|md|prisma|css|scss|rs|py|yml|yaml|toml|sql|html)$/i;
/** Prose/framework names that look like bare filenames but never are. */
const BARE_TOKEN_STOPLIST = new Set(['node.js', 'next.js', 'nuxt.js', 'vue.js', 'express.js']);

/** Cap for evidence text (mirrors automated-verifier's MAX_DETAIL_CHARS). */
const MAX_DETAIL_CHARS = 2_000;
/** Criterion text is truncated in details lines to keep verify.md readable. */
const MAX_CRITERION_CHARS = 80;

/**
 * Parses Task.acceptanceCriteria (a JSON string array column) into a string
 * list. Malformed / empty input yields [] (fail-open downstream).
 *
 * @param raw - Column value. / acceptanceCriteria列の生値
 * @returns Criteria strings. / 受入基準の配列
 */
export function parseAcceptanceCriteria(raw: string | null | undefined): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Extracts the bullet items under a `## 受入基準` (or 受け入れ基準 /
 * "Acceptance Criteria") heading in a task description. Many tasks carry
 * their criteria only as description Markdown (this feature's own task 617
 * did), so relying on the DB column alone would fail-open on most of them.
 *
 * @param description - Task description Markdown. / タスク説明
 * @returns Criteria bullet texts (without list markers). / 見出し配下の項目
 */
export function extractCriteriaFromDescription(description: string | null | undefined): string[] {
  if (!description) return [];
  const lines = description.split(/\r?\n/);
  const headingRe = /^#{2,4}\s*(?:(?:受入|受け入れ)基準|acceptance\s+criteria)\s*$/i;
  const out: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (headingRe.test(line.trim())) {
      inSection = true;
      continue;
    }
    if (inSection && /^#{1,4}\s/.test(line)) break; // next heading ends the section
    if (!inSection) continue;
    const m = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ x]\]\s*)?(.+)$/i);
    if (m && m[1].trim()) out.push(m[1].trim());
  }
  return out;
}

/**
 * Resolves a task's acceptance criteria: the structured column first, falling
 * back to the description's 受入基準 section when the column is empty.
 *
 * @param task - Column value + description. / タスクの列値と説明
 * @returns Deduplicated criteria. / 重複除去済みの受入基準
 */
export function resolveAcceptanceCriteria(task: {
  acceptanceCriteria?: string | null;
  description?: string | null;
}): string[] {
  const fromColumn = parseAcceptanceCriteria(task.acceptanceCriteria);
  const source =
    fromColumn.length > 0 ? fromColumn : extractCriteriaFromDescription(task.description);
  return [...new Set(source.map((c) => c.trim()).filter(Boolean))];
}

/** Strips a trailing `:12`, `:12:5` or `:12-34` line reference from a token. */
function stripLineRef(token: string): string {
  return token.replace(/:\d+(?:[-:]\d+)?$/, '');
}

/**
 * Extracts path / directory reference tokens from free text (criteria or the
 * task body). Backtick tokens follow scope-check's parsePlanFiles shapes;
 * bare tokens additionally require a path separator or a known file
 * extension, because free prose is noisier than plan.md's backtick format.
 *
 * @param text - Free text to scan. / 走査対象テキスト
 * @returns Unique normalized (forward-slash) tokens. / 正規化済みトークン一覧
 */
export function extractReferenceTokens(text: string): string[] {
  const out = new Set<string>();
  const considerBacktick = (piece: string, requireSeparator: boolean): void => {
    const token = stripLineRef(piece.trim()).replace(/\\/g, '/');
    if (!token) return;
    if (requireSeparator && !token.includes('/')) return;
    if (PATHISH_RE.test(token) || DIRISH_RE.test(token)) out.add(token);
  };
  let rest = text;
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    rest = rest.replace(m[0], ' ');
    const raw = m[1].trim();
    if (/\s/.test(raw)) {
      // Command/sentence token: only separator-bearing pieces are paths.
      for (const piece of raw.split(/\s+/)) considerBacktick(piece, true);
    } else {
      considerBacktick(raw, false);
    }
  }
  // Bare (non-backtick) tokens: split on whitespace + CJK/ASCII punctuation.
  for (const piece of rest.split(/[\s、。，（）「」『』【】()<>[\]{}"'`,;！？!?…]+/)) {
    const token = stripLineRef(piece.trim().replace(/[.,:;]+$/, '')).replace(/\\/g, '/');
    if (!token) continue;
    if (DIRISH_RE.test(token)) {
      if (token.includes('/')) out.add(token);
      continue;
    }
    if (!PATHISH_RE.test(token)) continue;
    if (token.includes('/')) {
      out.add(token);
    } else if (KNOWN_FILE_EXT_RE.test(token) && !BARE_TOKEN_STOPLIST.has(token.toLowerCase())) {
      out.add(token);
    }
  }
  return [...out];
}

/** Per-criterion match verdict (public shape — see matchCriteriaToChanges). */
export interface CriterionMatch {
  criterion: string;
  /** False when the criterion yields no reference token (→ treated as matched). */
  determinable: boolean;
  matched: boolean;
}

/** Internal: CriterionMatch plus the concrete files that satisfied it. */
interface CriterionMatchDetail extends CriterionMatch {
  files: string[];
}

/**
 * Whether a changed file is referenced by a token. Depth-tolerant like
 * scope-check's isInPlan: dir-prefix containment, path equality/suffix, or
 * basename equality for bare filename tokens. Case-insensitive (Windows).
 */
function fileMatchesToken(changedFile: string, token: string): boolean {
  const changed = changedFile.replace(/\\/g, '/').toLowerCase();
  const tok = token.toLowerCase();
  if (tok.endsWith('/')) {
    const dir = tok.replace(/\/+$/, '');
    return dir.length > 0 && `/${changed}`.includes(`/${dir}/`);
  }
  if (changed === tok) return true;
  if (tok.includes('/')) {
    return changed.endsWith(`/${tok}`) || tok.endsWith(`/${changed}`);
  }
  const base = changed.split('/').pop() ?? changed;
  return base === tok;
}

/** Matches every criterion's tokens against the changed-file set (rich form). */
function matchDetailed(criteria: string[], changedFiles: string[]): CriterionMatchDetail[] {
  return criteria.map((criterion) => {
    const tokens = extractReferenceTokens(criterion);
    if (tokens.length === 0) {
      // No reference token → cannot be judged mechanically. Treated as matched
      // so a prose-only criterion never produces a false NG (fail-open).
      return { criterion, determinable: false, matched: true, files: [] };
    }
    const files = changedFiles.filter((f) => tokens.some((t) => fileMatchesToken(f, t)));
    return { criterion, determinable: true, matched: files.length > 0, files };
  });
}

/**
 * Matches each acceptance criterion's reference tokens against the changed
 * files. Criteria without any token are indeterminable and count as matched.
 *
 * @param criteria - Acceptance criteria texts. / 受入基準
 * @param changedFiles - Changed paths (repo-relative). / 変更ファイル
 * @returns One verdict per criterion, in input order. / 基準ごとの判定
 */
export function matchCriteriaToChanges(
  criteria: string[],
  changedFiles: string[],
): CriterionMatch[] {
  return matchDetailed(criteria, changedFiles).map(({ criterion, determinable, matched }) => ({
    criterion,
    determinable,
    matched,
  }));
}

/** One human-readable mapping line per criterion (kept in verify.md). */
function mappingLine(m: CriterionMatchDetail): string {
  const label =
    m.criterion.length > MAX_CRITERION_CHARS
      ? `${m.criterion.slice(0, MAX_CRITERION_CHARS)}…`
      : m.criterion;
  if (!m.determinable) return `? ${label} (トークン抽出不能 — 機械判定の対象外)`;
  if (!m.matched) return `✗ ${label} (対応する変更ファイルなし)`;
  return `✓ ${label} ← ${m.files.slice(0, 3).join(', ')}`;
}

/**
 * ADVISORY acceptance self-check. `ok:false` ONLY on the two high-confidence
 * signals: (a) at least one determinable criterion matches no changed file
 * (task-614 shape) or (b) the changed-file set overlaps neither the criteria
 * nor the task text's tokens at all (task-608 unrelated-diff shape). Returns
 * null (fail-open) when criteria / changed files / determinable criteria are
 * absent — the adversarial diff review remains the final defense.
 *
 * @param params - Criteria, changed files, task title+description. / 照合入力
 * @returns An 'acceptance' check, or null when not judgeable. / 判定 or null
 */
export function evaluateAcceptanceSelfCheck(params: {
  criteria: string[];
  changedFiles: string[];
  taskText: string;
}): VerificationCheck | null {
  const { criteria, changedFiles, taskText } = params;
  if (criteria.length === 0 || changedFiles.length === 0) return null;

  const matches = matchDetailed(criteria, changedFiles);
  const determinable = matches.filter((m) => m.determinable);
  if (determinable.length === 0) return null; // no criterion is judgeable → fail-open

  const zeroMatch = determinable.filter((m) => !m.matched);
  const mapping = matches.map(mappingLine).join('\n');

  if (zeroMatch.length === 0) {
    return {
      name: 'acceptance',
      ran: true,
      ok: true,
      errorCount: 0,
      details:
        `acceptance: 全受入基準に対応する変更を確認（基準↔差分の対応付け）:\n${mapping}`.slice(
          0,
          MAX_DETAIL_CHARS,
        ),
    };
  }

  // Unrelated-diff (608) test: does ANY changed file overlap ANY token from the
  // criteria or the task body? If not, the whole diff looks off-task.
  const allTokens = extractReferenceTokens(`${criteria.join('\n')}\n${taskText}`);
  const anyOverlap = changedFiles.some((f) => allTokens.some((t) => fileMatchesToken(f, t)));

  const header = anyOverlap
    ? '以下の受入基準に対応する変更が差分に見つかりません。各基準を満たす変更を加えるか、' +
      '対応済みであればどのファイルが満たすかを最終サマリで説明してください:'
    : '変更ファイル集合が受入基準・タスク本文の言及対象と一切重なりません' +
      '（タスクと無関係な差分の可能性）。差分がこのタスクの要求に対応しているか確認してください:';
  return {
    name: 'acceptance',
    ran: true,
    ok: false,
    errorCount: zeroMatch.length,
    details: `${header}\n${mapping}`.slice(0, MAX_DETAIL_CHARS),
  };
}
