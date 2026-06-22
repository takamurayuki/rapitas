/**
 * owner-repo
 *
 * Branded types for GitHub owner/repo identities and the canonical
 * parseOwnerRepo parser. Provides OwnerRepo (parsed result with lowercase
 * guarantee) and OwnerRepoString (gh CLI --repo argument form).
 * Not responsible for git command execution — that lives in git-exec.ts.
 */

/**
 * Parsed GitHub owner + repo with guaranteed lowercase normalization.
 * Produced exclusively by {@link parseOwnerRepo}; never construct directly.
 *
 * @example `{ owner: 'myorg', repo: 'myrepo' }` (always lowercase)
 */
export type OwnerRepo = {
  readonly owner: string;
  readonly repo: string;
} & { readonly __ownerRepo: unique symbol };

/**
 * `"owner/repo"` string for gh CLI `--repo` arguments.
 * Always lowercase-normalized. Produce via {@link makeOwnerRepoString} or
 * {@link toOwnerRepoString}; never template-literal directly.
 */
export type OwnerRepoString = string & { readonly __ownerRepoString: unique symbol };

/**
 * Extract `{ owner, repo }` (lowercased) from a GitHub remote URL.
 * Accepts https (`https://github.com/owner/repo.git`) and ssh
 * (`git@github.com:owner/repo.git`) forms.
 * Returns null for non-github.com hosts or unparseable inputs.
 *
 * @param url - GitHub https or ssh URL / GitHubのhttpsまたはssh形式URL
 * @returns Lowercased {@link OwnerRepo}, or null when not parseable / 小文字のOwnerRepo、解析不能ならnull
 */
export function parseOwnerRepo(url: string | null | undefined): OwnerRepo | null {
  if (!url) return null;
  // NOTE: Limits to github.com; excludes query/fragment chars for strict matching.
  // ssh form: git@github.com:owner/repo(.git)
  // https form: https://github.com/owner/repo(.git)
  const m = url.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return { owner: m[1].toLowerCase(), repo: m[2].toLowerCase() } as OwnerRepo;
}

/**
 * Build an {@link OwnerRepoString} from owner and repo components.
 * Both components are lowercased before concatenation.
 *
 * @param owner - Repository owner / リポジトリオーナー
 * @param repo - Repository name / リポジトリ名
 * @returns Branded `"owner/repo"` string / Branded owner/repo文字列
 */
export function makeOwnerRepoString(owner: string, repo: string): OwnerRepoString {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}` as OwnerRepoString;
}

/**
 * Convert a parsed {@link OwnerRepo} struct to an {@link OwnerRepoString} for
 * gh CLI use. Since OwnerRepo already guarantees lowercase, no re-normalization
 * is performed.
 *
 * @param or - Parsed owner/repo / パース済みowner/repo
 * @returns Branded string for gh CLI `--repo` / gh CLI用Branded文字列
 */
export function toOwnerRepoString(or: OwnerRepo): OwnerRepoString {
  return `${or.owner}/${or.repo}` as OwnerRepoString;
}

/**
 * Cast a pre-validated string to {@link OwnerRepoString} without runtime checks.
 * Use ONLY at verified trust boundaries: tests, external API responses already
 * confirmed to be in `"owner/repo"` form.
 * WARNING: This is an unsafe escape hatch — the string is NOT validated.
 *
 * @param s - Pre-validated `"owner/repo"` string / 検証済み"owner/repo"文字列
 * @returns Branded string / Branded文字列
 */
export function asOwnerRepoString(s: string): OwnerRepoString {
  return s as OwnerRepoString;
}
