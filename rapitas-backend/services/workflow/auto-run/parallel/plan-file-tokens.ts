/**
 * plan-file-tokens
 *
 * Decides whether a token scraped from plan prose names a file. Not
 * responsible for reading plans — collectPlanFiles passes each token in.
 */

// A bare token (no folder) counts as a file only with one of these extensions.
// NOTE: parsePlanFiles also returns dotted prose such as `mock.module` and
// `process.env`; read as files they made every two plans that mention them
// refuse each other (2026-11-27, 5 of 8 parallel refusals were `mock.module`).
const FILE_EXTENSION_RE =
  /\.(?:[cm]?[jt]sx?|json|jsonc|md|mdx|prisma|sql|ya?ml|toml|css|scss|html|rs|sh|ps1|lock|txt|svg|png|example)$/i;

// Tools a plan runs but never edits. Every plan quotes the test command
// `node ../scripts/run-checked.cjs ...`, so as a file it made every pair overlap.
const EXECUTED_ONLY_RE = /(?:^|\/)scripts\/run-checked\.cjs$/;

/**
 * Whether a normalised plan token is likely a real file path.
 *
 * @param path - Token from the plan / 計画から拾った語
 * @returns true for a path with a folder or a known file extension / ファイルらしいか
 */
export function isLikelyFile(path: string): boolean {
  if (EXECUTED_ONLY_RE.test(path)) return false;
  return path.includes('/') || FILE_EXTENSION_RE.test(path);
}
