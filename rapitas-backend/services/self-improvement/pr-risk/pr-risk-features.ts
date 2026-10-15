/**
 * pr-risk-features
 *
 * Extracts the PR-risk model's input features from `gh pr view --json`
 * output (diff size, file count, human/agent author, dependency and Prisma
 * schema changes). Author is deliberately binary — personal identity is never
 * a model input (bias/privacy).
 */
import type { FeatureVector } from './pr-risk-types';

export interface GhPrFiles {
  additions: number;
  deletions: number;
  changedFiles: number;
  files: Array<{ path: string }>;
}

const DEPENDENCY_FILES = new Set([
  'package.json',
  'bun.lock',
  'bun.lockb',
  'pnpm-lock.yaml',
  'package-lock.json',
  'Cargo.toml',
  'Cargo.lock',
]);

const basename = (p: string): string => p.split('/').pop() ?? p;

/**
 * Map a PR's diff summary to the feature vector.
 *
 * @param gh - additions/deletions/changedFiles/files from gh / gh の PR 情報
 * @param ctx - hasLinkedTask: agent-authored when a rapitas task owns the PR / 文脈
 * @returns Feature vector / 特徴量
 */
export function extractFeatures(gh: GhPrFiles, ctx: { hasLinkedTask: boolean }): FeatureVector {
  const paths = (gh.files ?? []).map((f) => f.path.replace(/\\/g, '/'));
  return {
    file_size: Math.log(1 + (gh.additions ?? 0) + (gh.deletions ?? 0)),
    files_changed: Math.log(1 + (gh.changedFiles ?? 0)),
    author: ctx.hasLinkedTask ? 0 : 1,
    dependency_change: paths.some((p) => DEPENDENCY_FILES.has(basename(p))) ? 1 : 0,
    schema_change: paths.some((p) => /(^|\/)prisma\/schema\//.test(p)) ? 1 : 0,
  };
}

/**
 * Extract `owner/repo` from a GitHub PR URL.
 *
 * @param url - PR URL / PR の URL
 * @returns owner/repo or null / リポジトリ名
 */
export function parseRepoFromUrl(url: string): string | null {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\//.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

export interface PrSnapshot {
  repo: string;
  headSha: string;
  features: FeatureVector;
}

export type GhRunner = (args: string[], cwd: string) => Promise<string>;

/**
 * Read a PR once via gh and derive repo, head SHA and features.
 *
 * @param cwd - Repo working directory / 作業ディレクトリ
 * @param prNumber - PR number / PR番号
 * @param ctx - hasLinkedTask / 文脈
 * @param runGh - gh runner (DI) / gh 実行関数
 * @returns Snapshot / PR スナップショット
 * @throws {Error} When gh fails or returns unparsable JSON / gh 失敗時
 */
export async function fetchPrSnapshot(
  cwd: string,
  prNumber: number,
  ctx: { hasLinkedTask: boolean },
  runGh: GhRunner,
): Promise<PrSnapshot> {
  const out = await runGh(
    [
      'pr',
      'view',
      String(prNumber),
      '--json',
      'additions,deletions,changedFiles,files,headRefOid,url',
    ],
    cwd,
  );
  const json = JSON.parse(out) as GhPrFiles & { headRefOid: string; url: string };
  const repo = parseRepoFromUrl(json.url);
  if (!repo || !json.headRefOid)
    throw new Error(`pr-risk: unexpected gh pr view output for #${prNumber}`);
  return { repo, headSha: json.headRefOid, features: extractFeatures(json, ctx) };
}
