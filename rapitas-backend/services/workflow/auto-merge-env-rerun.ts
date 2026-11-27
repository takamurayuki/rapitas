/**
 * auto-merge-env-rerun
 *
 * When EVERY failing check of an auto-merge candidate matches a known
 * environmental failure signature (e.g. apt-get timing out on the runner),
 * re-run just the failed jobs once per head SHA instead of bouncing ci_repair.
 * NOT responsible for deciding the signatures (auto-merge-env-failure-signatures)
 * nor for the cancelled-check rerun (auto-merge-cancelled-checks).
 *
 * Why: on 2026-11-24 the Ubuntu runner's apt-get exceeded 600s twice and failed
 * `Build (ubuntu-latest)` / `Check Rust Code` on PRs #1711, #1712 and #1715.
 * The code was fine and a plain re-run went green, but ci_repair would have
 * spent an implementer run on a diff that was never broken.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
import { ghPath, readHeadSha, readPrChecks } from './auto-merge-checks';
import type { PrCheck } from './auto-merge-checks';
import { matchEnvFailureSignature } from './auto-merge-env-failure-signatures';
import type { Candidate } from './auto-merge-candidates';

const execAsync = promisify(exec);
const log = createLogger('workflow:auto-merge-env-rerun');

/** WorkflowTransition.cause recording one rerun of an environmental failure. */
export const ENV_FAILURE_RERUN_CAUSE = 'auto_merge_env_failure_rerun';

/** Reruns allowed per head SHA; a repeat is no longer a one-off. */
const MAX_ENV_RERUNS_PER_HEAD = 1;

/**
 * 指定した head SHA の環境要因による再実行を数える。
 * 履歴を取得できない場合は null を返す。
 */
async function envRerunsSpentFor(taskId: number, headSha: string): Promise<number | null> {
  const rows = await prisma.workflowTransition
    .findMany({ where: { taskId, cause: ENV_FAILURE_RERUN_CAUSE }, select: { metadata: true } })
    .catch((err: unknown) => {
      log.warn({ err, taskId, headSha }, '環境要因による再実行の履歴を取得できませんでした');
      return null;
    });
  if (rows === null) return null;
  return rows.filter((r) => {
    if (!r.metadata) return false;
    try {
      return (JSON.parse(r.metadata) as { headSha?: unknown }).headSha === headSha;
    } catch {
      return false;
    }
  }).length;
}

/** One failing check, identified by name plus the Actions run and job behind it. */
interface FailingEntry {
  name: string;
  runId: string;
  jobId: string;
}

/**
 * Every failing entry of a checks list, or null when any failing entry is not an
 * Actions job URL (nothing to read or re-run, so it cannot be proven environmental).
 */
function failingEntries(checks: PrCheck[]): FailingEntry[] | null {
  const out: FailingEntry[] = [];
  for (const ch of checks) {
    if (ch.bucket !== 'fail') continue;
    const m = ch.link?.match(/\/actions\/runs\/(\d+)\/job\/(\d+)/);
    if (!m) return null;
    out.push({ name: ch.name, runId: m[1], jobId: m[2] });
  }
  return out;
}

const entryKey = (e: FailingEntry) => `${e.name}\t${e.runId}\t${e.jobId}`;

/** Whether two failing sets hold exactly the same name+run+job entries. */
function sameEntries(a: FailingEntry[], b: FailingEntry[]): boolean {
  const ka = new Set(a.map(entryKey));
  const kb = new Set(b.map(entryKey));
  return ka.size === kb.size && [...ka].every((k) => kb.has(k));
}

/** Whether the entries cover exactly the given check names (and at least one). */
function sameNames(entries: FailingEntry[], names: string[]): boolean {
  const en = new Set(entries.map((e) => e.name));
  const nn = new Set(names);
  return en.size > 0 && en.size === nn.size && [...en].every((n) => nn.has(n));
}

/**
 * Read the head SHA a workflow run executed against.
 * Returns null on any gh error or malformed output so callers fail closed.
 */
async function readRunHeadSha(cwd: string, runId: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`${ghPath()} run view ${runId} --json headSha`, {
      cwd,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(stdout) as { headSha?: unknown };
    return typeof parsed.headSha === 'string' && parsed.headSha ? parsed.headSha : null;
  } catch {
    return null;
  }
}

/**
 * Re-run the failed jobs once when all failing checks are known environmental failures.
 *
 * Returns false — "not handled, continue to ci_repair" — when there are no
 * failures, a failing check has no readable Actions job log or matches no
 * signature, the head SHA already had its rerun, or gh refuses every rerun.
 * 履歴を取得できない場合も false を返し、呼び出し元の修復判定に進む。
 *
 * @param c - The auto-merge candidate whose CI failed. / 対象候補
 * @param failedChecks - Names of the failing blocking checks. / 失敗チェック名
 * @returns true when a rerun was dispatched and the next tick re-evaluates. / 再実行を投げたか
 */
export async function handleEnvFailureRerun(
  c: Candidate,
  failedChecks: string[],
): Promise<boolean> {
  if (failedChecks.length === 0) return false;

  // Pin the head BEFORE any gh call that can lag behind a push (the checks
  // list, the logs, the run lookups): the budget key, the run-head check and
  // the record must all describe this one head. Unreadable → cannot prove which
  // head these failures belong to, so fall through to ci_repair.
  const headSha = await readHeadSha(c.cwd, c.prNumber);
  if (!headSha) return false;
  const spent = await envRerunsSpentFor(c.taskId, headSha);
  if (spent === null) return false;
  if (spent >= MAX_ENV_RERUNS_PER_HEAD) {
    log.info(
      { taskId: c.taskId, prNumber: c.prNumber, headSha },
      '[auto-merge] Environmental failure repeated on the same head — falling through to ci_repair',
    );
    return false;
  }

  // judged: EVERY failing entry the list reports (name + run + job), not only
  // the names the caller passed — a check that went red after the caller read
  // its snapshot must be judged too, and a lone non-environmental one among
  // them must still reach ci_repair. Entries without an Actions job URL cannot
  // be log-read or re-run, so they cannot be proven environmental either.
  const checks = await readPrChecks(c.cwd, c.prNumber).catch(() => null);
  if (!checks) return false;
  const judged = failingEntries(checks);
  if (!judged || !sameNames(judged, failedChecks)) return false;

  const signatureIds: string[] = [];
  const seenJobs = new Set<string>();
  for (const e of judged) {
    if (seenJobs.has(e.jobId)) continue;
    seenJobs.add(e.jobId);
    let stdout: string;
    try {
      ({ stdout } = await execAsync(`${ghPath()} run view --job ${e.jobId} --log-failed`, {
        cwd: c.cwd,
        encoding: 'utf8',
      }));
    } catch {
      return false; // unreadable log → cannot prove it is environmental
    }
    const sig = matchEnvFailureSignature(stdout);
    if (!sig) return false;
    if (!signatureIds.includes(sig.id)) signatureIds.push(sig.id);
  }

  // The runs to re-run come from the judged set only — never from a later read.
  const runIds = [...new Set(judged.map((e) => e.runId))];

  // Every run being re-run must belong to the pinned head: the checks list
  // links runs but says nothing about which commit they ran on, and a push
  // during the lookups would otherwise re-run an OLD head's run and book it
  // against the new head's budget. One lookup per distinct run; any mismatch
  // or unreadable answer rejects the whole batch (no partial reruns).
  for (const runId of runIds) {
    if ((await readRunHeadSha(c.cwd, runId)) !== headSha) return false;
  }
  // Closing re-check, right before acting: the head must still be the pinned
  // one AND the failing set must still be exactly what was judged. Anything
  // that changed since (a new red check, a recovered one, a swapped job/run)
  // was not judged, so do nothing; the next tick re-evaluates from scratch.
  if ((await readHeadSha(c.cwd, c.prNumber)) !== headSha) return false;
  const latestChecks = await readPrChecks(c.cwd, c.prNumber).catch(() => null);
  if (!latestChecks) return false;
  const latest = failingEntries(latestChecks);
  if (!latest || !sameEntries(latest, judged) || !sameNames(latest, failedChecks)) return false;

  const rerun: string[] = [];
  for (const runId of runIds) {
    try {
      // --failed re-runs only the failed jobs, so passing legs are not paid for twice.
      await execAsync(`${ghPath()} run rerun ${runId} --failed`, { cwd: c.cwd, encoding: 'utf8' });
      rerun.push(runId);
    } catch (err) {
      log.warn({ err, taskId: c.taskId, runId }, '[auto-merge] Failed to rerun an env-failed run');
    }
  }
  if (rerun.length === 0) return false;

  await recordTransition({
    taskId: c.taskId,
    fromStatus: 'completed',
    toStatus: 'completed',
    actor: 'system',
    cause: ENV_FAILURE_RERUN_CAUSE,
    phase: 'verify',
    metadata: {
      headSha,
      prNumber: c.prNumber,
      attempt: 1,
      runIds: rerun,
      failedChecks,
      signatures: signatureIds,
    },
  });
  log.info(
    { taskId: c.taskId, prNumber: c.prNumber, headSha, runIds: rerun, signatures: signatureIds },
    '[auto-merge] Known environmental CI failure — re-ran failed jobs once instead of bouncing ci_repair',
  );
  return true;
}
