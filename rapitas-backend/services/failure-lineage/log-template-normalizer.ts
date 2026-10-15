/**
 * log-template-normalizer
 *
 * Detects ERROR/WARN lines in raw execution-log text and normalizes them into
 * templates (numbers, UUIDs, paths, hashes and branch names replaced by
 * placeholders) so that recurrences of one event collapse into one cluster.
 * Regex-rule based only; it does not learn templates (Drain-style) on purpose.
 */
import { createHash } from 'node:crypto';
import type { LineageLevel } from './failure-lineage-types';

/** Longest text considered; keeps regex cost bounded on pathological lines. */
export const MAX_LINE_LENGTH = 2000;

const ERROR_RE = /\bERROR\b/;
const WARN_RE = /\bWARN(?:ING)?\b/;

/**
 * Decides the severity of a log row.
 *
 * @param logType - `AgentExecutionLog.logType` / ログ種別
 * @param text - Log body / ログ本文
 * @returns `ERROR` / `WARN`, or null when the row is neither / レベル、該当なしはnull
 */
export function detectLevel(logType: string, text: string): LineageLevel | null {
  // NOTE: stderr is intentionally NOT treated as error — CLIs write progress there.
  const type = logType.toLowerCase();
  if (type === 'error') return 'ERROR';
  if (ERROR_RE.test(text)) return 'ERROR';
  if (type === 'warn' || type === 'warning') return 'WARN';
  if (WARN_RE.test(text)) return 'WARN';
  return null;
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PREFIXED_BRANCH_RE =
  /\b(?:origin\/)?(?:feature|bugfix|hotfix|fix|release|task|chore|refactor)\/[\w.\-/]+/g;
const ORIGIN_BRANCH_RE = /\borigin\/(?:main|master|develop)\b/g;
const BRANCH_KEYWORD_RE = /\b(branch\s+)['"`]?[\w.\-/]+['"`]?/gi;
const WIN_PATH_RE = /\b[A-Za-z]:\\[^\s'"`]+/g;
const POSIX_PATH_RE = /(?:^|[\s'"`(=])(\/[\w.\-@]+(?:\/[\w.\-@]+)+)/g;
const HASH_RE = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi;
// NOTE: lookbehind (not \b) so unit-suffixed values like "30s" still normalize.
const NUM_RE = /(?<![A-Za-z_])\d+(?:\.\d+)?/g;

/**
 * Replaces variable fragments with placeholders.
 *
 * @param text - Log body / ログ本文
 * @returns Normalized template / 正規化後テンプレート
 */
export function normalizeTemplate(text: string): string {
  let s = text.slice(0, MAX_LINE_LENGTH);
  s = s.replace(UUID_RE, '<UUID>');
  s = s.replace(PREFIXED_BRANCH_RE, '<BRANCH>');
  s = s.replace(ORIGIN_BRANCH_RE, '<BRANCH>');
  s = s.replace(BRANCH_KEYWORD_RE, '$1<BRANCH>');
  s = s.replace(WIN_PATH_RE, '<PATH>');
  s = s.replace(POSIX_PATH_RE, (m, p: string) => m.replace(p, '<PATH>'));
  s = s.replace(HASH_RE, '<HASH>');
  s = s.replace(NUM_RE, '<NUM>');
  // Timestamps/ids leave runs of placeholders; collapse whitespace for stable clustering.
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Derives a short stable cluster id from a template.
 *
 * @param template - Normalized template / 正規化テンプレート
 * @returns 10-hex-char id / テンプレートID
 */
export function templateIdOf(template: string): string {
  return createHash('sha1').update(template).digest('hex').slice(0, 10);
}

const TASK_RE = /\btask[\s#:_-]*(\d{1,9})\b/gi;
const BRANCH_NAME_RE =
  /(?:\b(?:origin\/)?(?:feature|bugfix|hotfix|fix|release|task|chore|refactor)\/[\w.\-/]+|\bbranch\s+['"`]?([\w.\-/]+)['"`]?)/gi;

/**
 * Extracts resource keys (branches and task ids) used as the "same resource"
 * correlation attribute — there is no trace id in the log schema.
 *
 * @param text - Log body / ログ本文
 * @returns Sorted unique keys such as `branch:feature/x` / リソースキー
 */
export function extractResources(text: string): string[] {
  const body = text.slice(0, MAX_LINE_LENGTH);
  const keys = new Set<string>();
  for (const m of body.matchAll(BRANCH_NAME_RE)) {
    const name = (m[1] ?? m[0]).replace(/^origin\//, '');
    keys.add(`branch:${name}`);
  }
  for (const m of body.matchAll(TASK_RE)) keys.add(`task:${m[1]}`);
  return [...keys].sort();
}
