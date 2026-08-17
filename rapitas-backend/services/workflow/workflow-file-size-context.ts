/**
 * WorkflowFileSizeContext
 *
 * Builds the implementer's "file-size awareness" prompt section: for every file
 * the approved plan.md references, reports its CURRENT line count when it
 * already breaches the soft (300) / hard (500) limits from
 * COMPONENT_SPLITTING_POLICY.md — so the implementer knows BEFORE touching the
 * file that it needs splitting, instead of discovering it in CI (task 600).
 * Best-effort: any failure yields '' so context building never breaks.
 * Not responsible for enforcing the limits — that stays in CI
 * (scripts/check-large-files.cjs).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createLogger } from '../../config/logger';
import { parsePlanFiles } from '../agents/verification/scope-check';

const log = createLogger('workflow:file-size-context');

// NOTE: Mirrors SOFT_LIMIT/HARD_LIMIT in scripts/check-large-files.cjs.
// Intentionally duplicated (10 lines of logic) instead of importing across the
// ESM(backend)/CommonJS(root scripts) boundary — change one, review the other.
const SOFT_LIMIT = 300;
const HARD_LIMIT = 500;

/** Repo root: this file lives at rapitas-backend/services/workflow/. */
const REPO_ROOT = path.resolve(import.meta.dir, '..', '..', '..');

/**
 * Prefixes tried in order when resolving a plan path to a real file. Plans
 * write paths at varying depths (repo-relative, package-relative, bare) — the
 * same looseness scope-check.ts absorbs in the opposite direction.
 */
const ROOT_CANDIDATES = [
  '',
  'rapitas-backend',
  'rapitas-frontend/src',
  'rapitas-frontend',
  'rapitas-desktop/src-tauri/src',
  'rapitas-desktop',
];

/** One over-limit file referenced by the plan. */
export interface FileSizeRow {
  /** Path as written in plan.md. / plan.md 記載のパス */
  planPath: string;
  /** Repo-root-relative path of the resolved file. / 解決済み相対パス */
  resolvedPath: string;
  /** Current line count. / 現在の行数 */
  lines: number;
  /** Which limit is breached. / 超過している制限 */
  severity: 'soft' | 'hard';
}

// NOTE: Same newline-counting algorithm as scripts/check-large-files.cjs
// countLines() — keep in sync so the warning matches what CI will measure.
function countLines(absPath: string): number {
  const text = readFileSync(absPath, 'utf8');
  if (text.length === 0) return 0;
  let lines = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  if (text.charCodeAt(text.length - 1) !== 10) lines++;
  return lines;
}

/**
 * Resolves a plan-written path to an existing file under repoRoot, trying each
 * candidate prefix in order. Returns null when nothing exists (fail open) or
 * the resolved path escapes repoRoot (path traversal guard).
 */
function resolveExisting(repoRoot: string, relPath: string): string | null {
  for (const prefix of ROOT_CANDIDATES) {
    const candidate = path.resolve(repoRoot, prefix, relPath);
    // Path traversal guard: a plan token like `../../etc/passwd` must never
    // resolve outside the repo.
    if (!candidate.startsWith(path.resolve(repoRoot) + path.sep)) continue;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Classifies the plan's file references by current size, keeping only files
 * over the soft/hard limit.
 *
 * @param repoRoot - Repository root to resolve against. / 解決基準のリポジトリルート
 * @param relPaths - Paths extracted from plan.md. / plan.md 由来のパス一覧
 * @returns Over-limit rows, largest first. / 超過ファイル行（行数降順）
 */
export function classifyFileSizeRows(repoRoot: string, relPaths: string[]): FileSizeRow[] {
  const rows: FileSizeRow[] = [];
  const seen = new Set<string>();
  for (const rel of relPaths) {
    // Directory tokens (scope declarations) have no line count of their own.
    if (rel.endsWith('/')) continue;
    const abs = resolveExisting(repoRoot, rel);
    if (!abs) continue; // fail open: unresolvable path must not block anything
    if (seen.has(abs)) continue; // repo-relative + package-relative duplicates
    seen.add(abs);
    let lines: number;
    try {
      lines = countLines(abs);
    } catch {
      continue;
    }
    if (lines <= SOFT_LIMIT) continue;
    rows.push({
      planPath: rel,
      resolvedPath: path.relative(repoRoot, abs).replace(/\\/g, '/'),
      lines,
      severity: lines > HARD_LIMIT ? 'hard' : 'soft',
    });
  }
  rows.sort((a, b) => b.lines - a.lines);
  return rows;
}

/**
 * Renders the over-limit rows as the Markdown warning section, or '' when
 * every referenced file is within limits.
 *
 * @param rows - Output of classifyFileSizeRows. / 超過ファイル行
 * @param language - Prompt language. / プロンプト言語
 * @returns Markdown section or empty string. / セクション文字列
 */
export function formatFileSizeAwarenessSection(
  rows: FileSizeRow[],
  language: 'ja' | 'en' = 'ja',
): string {
  if (rows.length === 0) return '';
  const header =
    language === 'en'
      ? '## ⚠️ Line counts of the files this plan touches (measured before you start)'
      : '## ⚠️ 変更対象ファイルの行数状況(着手前の実測)';
  const lines = rows.map((r) => {
    if (language === 'en') {
      return r.severity === 'hard'
        ? `- **${r.resolvedPath}** — ${r.lines} lines, ALREADY over the hard limit (500). CI fails if this file grows; do not add net lines — split first or keep the delta ≤ 0.`
        : `- **${r.resolvedPath}** — ${r.lines} lines, over the soft limit (300). Split at this edit per COMPONENT_SPLITTING_POLICY.md, or keep additions minimal.`;
    }
    return r.severity === 'hard'
      ? `- **${r.resolvedPath}** — 現在 ${r.lines} 行で hard 上限(500行)を既に超過。これ以上増えるとCIの行数ゲートが失敗する。純増させないこと(先に分割するか、追記は既存行の削減とセットにする)。`
      : `- **${r.resolvedPath}** — 現在 ${r.lines} 行で soft 上限(300行)を超過。COMPONENT_SPLITTING_POLICY.md に従い、この編集での分割を検討し、追記は最小限にすること。`;
  });
  const footer =
    language === 'en'
      ? 'Limits and splitting recipes: COMPONENT_SPLITTING_POLICY.md. The CI ratchet gate (scripts/check-large-files.cjs) fails when a baseline file grows or a new file exceeds 500 lines.'
      : '上限と分割手順は COMPONENT_SPLITTING_POLICY.md を参照。CIのratchetゲート(scripts/check-large-files.cjs)は、baseline記載ファイルの増加または新規500行超で失敗する。';
  return `${header}\n\n${lines.join('\n')}\n\n${footer}`;
}

/**
 * Builds the file-size awareness section for the implementer from the approved
 * plan.md content. Returns '' when the plan references no over-limit files or
 * on any internal failure (best-effort, same contract as the other context
 * builders).
 *
 * @param planContent - plan.md text. / plan.md の内容
 * @param language - Prompt language. / プロンプト言語
 * @param repoRoot - Override for tests. / テスト用リポジトリルート上書き
 * @returns Markdown section or empty string. / セクション文字列
 */
export function buildFileSizeAwarenessSection(
  planContent: string,
  language: 'ja' | 'en' = 'ja',
  repoRoot: string = REPO_ROOT,
): string {
  try {
    const rows = classifyFileSizeRows(repoRoot, parsePlanFiles(planContent));
    const section = formatFileSizeAwarenessSection(rows, language);
    if (section) {
      // Observability: lets "did warned tasks stop growing oversized files?"
      // be answered later from logs.
      log.info(
        { files: rows.map((r) => ({ path: r.resolvedPath, lines: r.lines, severity: r.severity })) },
        '[file-size-context] File-size awareness injected into implementer context',
      );
    }
    return section;
  } catch (err) {
    log.debug({ err }, '[file-size-context] Failed to build file-size awareness section');
    return '';
  }
}
