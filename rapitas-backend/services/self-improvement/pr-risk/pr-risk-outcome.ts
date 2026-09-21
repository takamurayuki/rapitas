/**
 * pr-risk-outcome
 *
 * The strict failure definition for PR-risk labels: a revert of the PR landing
 * on the base branch within the CLOSED 72h window after merge, or an
 * operator-registered critical incident. CI red, concerns and late reverts are
 * deliberately NOT failures. Pure classification + a DI'd collector.
 */
import { ROLLBACK_WINDOW_MS, type FailureKind, type OutcomeLabel } from './pr-risk-types';

export interface RevertCommit {
  sha: string;
  at: Date;
  subject: string;
  body: string;
}

export interface OutcomeClassification {
  label: OutcomeLabel;
  failureKind: FailureKind | null;
  revertSha: string | null;
  revertAt: Date | null;
}

/**
 * Classify one PR's post-merge outcome.
 *
 * @param p - mergedAt, reverts already matched to this PR, incident flag, now / 入力
 * @returns label + failure kind / ラベル
 */
export function classifyOutcome(p: {
  mergedAt: Date | null;
  reverts: Array<{ sha: string; at: Date }>;
  incident: boolean;
  now: Date;
}): OutcomeClassification {
  const none = { failureKind: null, revertSha: null, revertAt: null };
  if (p.incident) return { label: 'failure', ...none, failureKind: 'critical_incident' };
  if (!p.mergedAt) return { label: 'pending', ...none };
  const merged = p.mergedAt.getTime();
  const hit = p.reverts.find((r) => {
    const delta = r.at.getTime() - merged;
    return delta >= 0 && delta <= ROLLBACK_WINDOW_MS;
  });
  if (hit)
    return { label: 'failure', failureKind: 'rollback_72h', revertSha: hit.sha, revertAt: hit.at };
  return { label: merged + ROLLBACK_WINDOW_MS <= p.now.getTime() ? 'success' : 'pending', ...none };
}

/**
 * Whether a base-branch commit reverts the given PR.
 *
 * @param c - Commit subject/body / コミット
 * @param pr - PR number, title, merge SHA and its commit SHAs / PR情報
 * @returns true when any of the three revert rules match / 一致するか
 */
export function matchesRevert(
  c: Pick<RevertCommit, 'sha' | 'subject' | 'body'>,
  pr: { number: number; title: string; mergeSha: string | null; commitShas: string[] },
): boolean {
  const shas = new Set([pr.mergeSha, ...pr.commitShas].filter((s): s is string => !!s));
  for (const m of c.body.matchAll(/This reverts commit ([0-9a-f]+)/gi)) {
    if (shas.has(m[1])) return true;
  }
  if (c.subject === `Revert "${pr.title}"`) return true;
  return c.subject.startsWith('Revert') && c.subject.includes(`(#${pr.number})`);
}

/**
 * Parse `git log --format=%H%x1f%cI%x1f%B%x1e` output.
 *
 * @param stdout - Raw git log output / git log 出力
 * @returns Commits with parsed commit time / コミット一覧
 */
export function parseRevertLog(stdout: string): RevertCommit[] {
  return stdout
    .split('\x1e')
    .map((rec) => rec.replace(/^\s+/, ''))
    .filter((rec) => rec.includes('\x1f'))
    .map((rec) => {
      const [sha, iso, message = ''] = rec.split('\x1f');
      const trimmed = message.trim();
      const nl = trimmed.indexOf('\n');
      return {
        sha: sha.trim(),
        at: new Date(iso),
        subject: nl === -1 ? trimmed : trimmed.slice(0, nl),
        body: trimmed,
      };
    })
    .filter((c) => !Number.isNaN(c.at.getTime()));
}

/** A PR whose outcome is not settled yet. */
export interface PendingPr {
  repo: string;
  prNumber: number;
  incidentNote: string | null;
}

export interface PrMergeInfo {
  title: string;
  mergedAt: string | null;
  mergeSha: string | null;
  baseBranch: string;
  commitShas: string[];
}

export interface OutcomeRow extends OutcomeClassification {
  repo: string;
  prNumber: number;
  mergeSha: string | null;
  mergedAt: Date | null;
}

export interface OutcomeDeps {
  now: () => Date;
  viewPr: (repo: string, prNumber: number) => Promise<PrMergeInfo>;
  /** Base-branch history since <iso> in `git log --format=%H%x1f%cI%x1f%B%x1e` shape. */
  gitLog: (repo: string, baseBranch: string, sinceIso: string) => Promise<string>;
  saveOutcome: (row: OutcomeRow) => Promise<void>;
}

/**
 * Re-label unsettled PRs. Per-PR failures are skipped (logged by the caller's
 * job wrapper) so one broken PR never blocks the rest.
 *
 * @param prs - Unsettled PRs / 未確定PR
 * @param deps - gh/git/DB side effects / 依存注入
 * @returns Number of PRs that reached a final label / 確定件数
 */
export async function collectOutcomes(prs: PendingPr[], deps: OutcomeDeps): Promise<number> {
  let settled = 0;
  for (const pr of prs) {
    try {
      const info = await deps.viewPr(pr.repo, pr.prNumber);
      const mergedAt = info.mergedAt ? new Date(info.mergedAt) : null;
      const reverts = mergedAt
        ? parseRevertLog(
            await deps.gitLog(pr.repo, info.baseBranch, mergedAt.toISOString()),
          ).filter((c) =>
            matchesRevert(c, {
              number: pr.prNumber,
              title: info.title,
              mergeSha: info.mergeSha,
              commitShas: info.commitShas,
            }),
          )
        : [];
      const cls = classifyOutcome({
        mergedAt,
        reverts,
        incident: !!pr.incidentNote,
        now: deps.now(),
      });
      await deps.saveOutcome({
        ...cls,
        repo: pr.repo,
        prNumber: pr.prNumber,
        mergeSha: info.mergeSha,
        mergedAt,
      });
      if (cls.label !== 'pending') settled++;
    } catch {
      /* skip this PR; it stays pending and is retried next run */
    }
  }
  return settled;
}
