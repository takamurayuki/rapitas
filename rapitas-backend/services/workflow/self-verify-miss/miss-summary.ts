/**
 * self-verify-miss/miss-summary
 *
 * Read side of the self-verify misses (task 1602): the judgment misses as the
 * input of task 1586 (learning review viewpoints from rejections), and the
 * counts, rates and "add to the catalog" candidates the daily report shows.
 * Not responsible for recording misses.
 */
import { queryEvents } from '../../memory/timeline';
import { ciCoverageOf, presaveCoverageOf } from '../../agents/verification/check-catalog/catalog';
import { SELF_VERIFY_MISS_EVENT, type MissKind, type SelfVerifyMissPayload } from './miss-classify';

const PAGE = 500;

/** Every event of a type in a window, paged past queryEvents' default 50. */
async function readAll(
  eventType: 'self_verify_miss' | 'verification_job_finished',
  since?: Date,
  until?: Date,
): Promise<Array<{ payload: Record<string, unknown>; createdAt: Date }>> {
  const out: Array<{ payload: Record<string, unknown>; createdAt: Date }> = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await queryEvents({ eventType, since, until, limit: PAGE, offset });
    out.push(...page.events);
    if (page.events.length < PAGE || out.length >= page.total) return out;
  }
}

/** Misses in a window, one per dedupKey (a race can write two). */
async function readMisses(since?: Date, until?: Date) {
  const seen = new Set<string>();
  const out: Array<SelfVerifyMissPayload & { createdAt: Date }> = [];
  for (const e of await readAll(SELF_VERIFY_MISS_EVENT, since, until)) {
    const p = e.payload as unknown as SelfVerifyMissPayload;
    if (seen.has(p.dedupKey)) continue;
    seen.add(p.dedupKey);
    out.push({ ...p, createdAt: e.createdAt });
  }
  return out;
}

/**
 * One judgment miss as task 1586 reads it — the input contract of 1586: the
 * reviewer's reason and the files, to be learned as a review viewpoint.
 */
export interface SelfVerifyMissLesson {
  taskId: number;
  runId: string;
  revision: string | null;
  gate: 'verify' | 'diff_review';
  reasonSummary: string;
  files: string[];
  createdAt: string;
}

/**
 * Judgment misses (verifier / diff review rejections after a passing self-verify),
 * newest first. Mechanical misses are never included.
 *
 * @param opts - Window and cap / 期間と件数上限
 * @returns Lessons for task 1586 / 1586 の学びの材料
 */
export async function listJudgmentMisses(
  opts: { since?: Date; until?: Date; limit?: number } = {},
): Promise<SelfVerifyMissLesson[]> {
  const misses = await readMisses(opts.since, opts.until);
  return misses
    .filter((m) => m.kind === 'judgment')
    .slice(0, opts.limit ?? 200)
    .map((m) => ({
      taskId: m.taskId,
      runId: m.runId,
      revision: m.revision,
      gate: m.gate as 'verify' | 'diff_review',
      reasonSummary: m.reasonSummary,
      files: m.files,
      createdAt: m.createdAt.toISOString(),
    }));
}

/** Count of misses and missed runs for one kind or gate. */
export interface MissBreakdown {
  key: string;
  kind: MissKind;
  misses: number;
  /** Passing runs in the window with at least one miss here. */
  missedRuns: number;
  /** missedRuns / passedRuns, null when no run passed. */
  rate: number | null;
}

/** A mechanical miss whose check the self-verifier does not (fully) run. */
export interface MissCandidate {
  gate: string;
  status: 'partial' | 'missing';
  uncoveredSteps: string[];
  misses: number;
}

/** The daily numbers. */
export interface SelfVerifyMissSummary {
  passedRuns: number;
  misses: number;
  missedRuns: number;
  rate: number | null;
  byKind: MissBreakdown[];
  byGate: MissBreakdown[];
  candidates: MissCandidate[];
}

function breakdown(
  key: string,
  kind: MissKind,
  misses: Array<SelfVerifyMissPayload>,
  passed: Set<string>,
): MissBreakdown {
  const runs = new Set(misses.map((m) => m.runId).filter((r) => passed.has(r)));
  return {
    key,
    kind,
    misses: misses.length,
    missedRuns: runs.size,
    rate: passed.size > 0 ? runs.size / passed.size : null,
  };
}

/** Coverage of the check behind a mechanical gate. */
function coverageOf(gate: string) {
  if (gate.startsWith('ci:')) return ciCoverageOf(gate.slice(3));
  return presaveCoverageOf(gate.slice(gate.indexOf(':') + 1));
}

/**
 * Misses, rates and catalog candidates in a window. The rate's denominator is
 * the passing self-verify runs that finished in the window; its numerator the
 * ones a later real gate contradicted.
 *
 * @param window - since / until / 集計期間
 * @returns The summary / 集計
 */
export async function summarizeSelfVerifyMisses(window: {
  since: Date;
  until: Date;
}): Promise<SelfVerifyMissSummary> {
  const passed = new Set<string>();
  for (const e of await readAll('verification_job_finished', window.since, window.until)) {
    const p = e.payload as {
      runId?: string;
      status?: string;
      ok?: boolean;
      unverifiable?: boolean;
    };
    if (p.runId && p.status === 'completed' && p.ok === true && !p.unverifiable)
      passed.add(p.runId);
  }
  const misses = await readMisses(window.since, window.until);
  const kinds: MissKind[] = ['mechanical', 'judgment'];
  const gates = [...new Set(misses.map((m) => m.gate))].sort();
  const candidates: MissCandidate[] = [];
  for (const gate of gates.filter((g) => g.startsWith('ci:') || g.startsWith('presave:'))) {
    const cov = coverageOf(gate);
    if (cov.status === 'covered') continue;
    const count = misses.filter((m) => m.gate === gate).length;
    candidates.push({
      gate,
      status: cov.status,
      uncoveredSteps: cov.uncoveredSteps,
      misses: count,
    });
  }
  candidates.sort((a, b) => b.misses - a.misses || a.gate.localeCompare(b.gate));
  const all = breakdown('all', 'mechanical', misses, passed);
  return {
    passedRuns: passed.size,
    misses: misses.length,
    missedRuns: all.missedRuns,
    rate: all.rate,
    byKind: kinds.map((k) =>
      breakdown(
        k,
        k,
        misses.filter((m) => m.kind === k),
        passed,
      ),
    ),
    byGate: gates.map((g) => {
      const of = misses.filter((m) => m.gate === g);
      return breakdown(g, of[0]!.kind, of, passed);
    }),
    candidates,
  };
}
