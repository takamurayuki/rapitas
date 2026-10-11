/**
 * base-satisfied-plan-items
 *
 * Decides, with git, whether a diff-review FAIL reason ("plan item X is not in
 * the diff") is really about a change that already exists on the base ref —
 * e.g. a sibling task's PR merged first. Deterministic post-filter for the
 * jury verdict; it does not call any model and never touches `diffBaseRef`.
 * Fail-closed: anything it cannot positively confirm stays a failure.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../../config/logger';
import { isNonVerdictOnlyFail, type DiffReviewResult } from './adversarial-diff-review-verdict';

const execFileAsync = promisify(execFile);
const log = createLogger('verification:base-satisfied-plan-items');

/** Wall-clock cap per git call; the review runs inside a synchronous request. */
const GIT_TIMEOUT_MS = 10_000;
/** Anchors shorter than this match too much to prove anything. */
const MIN_ANCHOR_LENGTH = 4;

/** Runs git with argv (no shell) in `cwd`; rejects on non-zero exit or timeout. */
export type GitRunner = (args: string[], cwd: string) => Promise<string>;

/** A fail reason that was confirmed to already hold on the base ref. */
export interface BaseSatisfiedFinding {
  /** The original fail reason text. */
  reason: string;
  /** Repo-relative path the reason points at (resolved on the base ref). */
  path: string;
  /** Strings that were all found in `path` on the base ref. */
  anchors: string[];
  /** Base ref the check ran against. */
  baseRef: string;
}

/** Result of partitioning fail reasons. */
export interface BaseSatisfiedPartition {
  satisfied: BaseSatisfiedFinding[];
  /** Reasons that could not be confirmed on base — these still count as fail. */
  remaining: string[];
}

/**
 * Post-filter a jury FAIL: drop reasons whose plan item already exists on the
 * base ref, so the same unsatisfiable finding is not bounced back repeatedly.
 * All reasons satisfied → pass; a mix → fail with only the unconfirmed ones.
 * Never throws; any error returns the input verdict unchanged.
 *
 * @param result - Aggregated jury result. / 陪審の集計結果
 * @param params.worktreePath - Worktree directory. / worktree
 * @param params.preferredBaseBranch - Theme default branch, as the review used. / 分岐元ブランチ
 * @param params.planContent - plan.md body. / plan 本文
 * @param params.changedFiles - Filenames in the reviewed diff. / 差分の変更ファイル
 * @returns Filtered result. / フィルタ後の結果
 */
export async function applyBaseSatisfiedFilter(
  result: DiffReviewResult,
  params: {
    worktreePath: string;
    preferredBaseBranch?: string | null;
    planContent: string;
    changedFiles: string[];
  },
): Promise<DiffReviewResult> {
  if (result.verdict !== 'fail' || result.reasons.length === 0) return result;
  try {
    // Dynamic import: shares the review's own base resolution without a static
    // edge to the git layer (and without touching automated-verifier's diffBaseRef).
    const { resolveBaseRef } = await import('../orchestrator/git-operations/core/diff-structured');
    const baseRef = await resolveBaseRef(params.worktreePath, params.preferredBaseBranch);
    if (!baseRef) return result;
    const { satisfied, remaining } = await findBaseSatisfiedReasons({
      reasons: result.reasons,
      planContent: params.planContent,
      changedFiles: params.changedFiles,
      cwd: params.worktreePath,
      baseRef,
    });
    if (satisfied.length === 0) return result;
    log.info(
      { baseRef, items: satisfied.map((s) => ({ path: s.path, anchors: s.anchors })) },
      '[base-satisfied] Fail reasons already hold on the base ref — not re-bouncing them',
    );
    if (remaining.length === 0 || isNonVerdictOnlyFail('fail', remaining)) {
      return { ...result, verdict: 'pass', severity: 0, reasons: [], baseSatisfied: satisfied };
    }
    return { ...result, reasons: remaining, baseSatisfied: satisfied };
  } catch (err) {
    log.warn({ err }, '[base-satisfied] Check errored — keeping the original verdict');
    return result;
  }
}

const defaultGit: GitRunner = async (args, cwd) => {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
};

const PATH_TOKEN_RE = /^[\w.@/\\-]+\.[A-Za-z][A-Za-z0-9]{0,5}(?::\d+(?:-\d+)?)?$/;

/** Normalise a backtick token to a repo-relative path candidate, or null. */
function toPathCandidate(token: string): string | null {
  const t = token.trim();
  if (!PATH_TOKEN_RE.test(t)) return null;
  return t
    .replace(/:\d+(?:-\d+)?$/, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

function backtickTokens(text: string): string[] {
  const out: string[] = [];
  const re = /`([^`\n]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]!.trim());
  return out;
}

/** Non-path backtick tokens usable as `git grep -F` anchors. */
function anchorsFrom(text: string): string[] {
  const seen = new Set<string>();
  for (const tok of backtickTokens(text)) {
    if (tok.length < MIN_ANCHOR_LENGTH || toPathCandidate(tok)) continue;
    seen.add(tok);
  }
  return [...seen];
}

/** Plan lines that mention the file, so their identifiers can back the check. */
function planAnchorsFor(planContent: string, path: string): string[] {
  const base = path.split('/').pop() ?? path;
  const seen = new Set<string>();
  for (const line of planContent.split('\n')) {
    if (!line.includes(base)) continue;
    for (const a of anchorsFrom(line)) seen.add(a);
  }
  return [...seen];
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Split fail reasons into those already satisfied on the base ref and the rest.
 *
 * A reason counts as satisfied only when ALL hold: it names exactly one file
 * that exists on `baseRef`; that file is not in the current diff; at least one
 * anchor (backticked identifier/expression — from the reason, else from plan
 * lines mentioning the file) exists, and every anchor is found in the file on
 * `baseRef`. File existence alone never qualifies.
 *
 * @param params.reasons - Fail reasons from the jury. / 陪審の不合格理由
 * @param params.planContent - plan.md body (anchor fallback). / plan 本文
 * @param params.changedFiles - Files present in the current diff. / 差分の変更ファイル
 * @param params.cwd - Worktree directory. / worktree
 * @param params.baseRef - Ref the diff was taken against. / 差分の基準 ref
 * @param params.git - Injectable git runner (tests). / git 実行関数
 * @returns Partition of reasons; unconfirmable ones stay in `remaining`. / 分類結果
 */
export async function findBaseSatisfiedReasons(params: {
  reasons: string[];
  planContent: string;
  changedFiles: string[];
  cwd: string;
  baseRef: string;
  git?: GitRunner;
}): Promise<BaseSatisfiedPartition> {
  const { reasons, planContent, cwd, baseRef } = params;
  const git = params.git ?? defaultGit;
  const changed = new Set(params.changedFiles.map(normalize));
  const result: BaseSatisfiedPartition = { satisfied: [], remaining: [] };

  let tree: string[];
  try {
    tree = (await git(['ls-tree', '-r', '--name-only', baseRef], cwd))
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (err) {
    log.warn({ err, baseRef }, '[base-satisfied] ls-tree failed — keeping all reasons as fail');
    return { satisfied: [], remaining: [...reasons] };
  }
  const treeSet = new Set(tree);

  for (const reason of reasons) {
    const finding = await checkReason(reason);
    if (finding) result.satisfied.push(finding);
    else result.remaining.push(reason);
  }
  return result;

  async function checkReason(reason: string): Promise<BaseSatisfiedFinding | null> {
    const candidates = [
      ...new Set(
        backtickTokens(reason)
          .map(toPathCandidate)
          .filter((p): p is string => !!p),
      ),
    ];
    if (candidates.length !== 1) return null; // none or ambiguous — cannot attribute.
    const cand = candidates[0]!;
    let path: string | null = null;
    if (treeSet.has(cand)) path = cand;
    else {
      const matches = tree.filter((f) => f.endsWith(`/${cand}`));
      if (matches.length === 1) path = matches[0]!;
    }
    if (!path) return null;
    if (changed.has(path)) return null; // the diff touches it — judge it there.

    const fromReason = anchorsFrom(reason);
    const anchors = fromReason.length > 0 ? fromReason : planAnchorsFor(planContent, path);
    if (anchors.length === 0) return null;

    for (const anchor of anchors) {
      try {
        // `-e` so an anchor starting with '-' is never parsed as an option.
        await git(['grep', '-F', '-q', '-e', anchor, baseRef, '--', path], cwd);
      } catch {
        return null; // no match (exit 1), git error or timeout — all fail-closed.
      }
    }
    return { reason, path, anchors, baseRef };
  }
}
