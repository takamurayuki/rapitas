/**
 * ContradictionSweep
 *
 * Nightly drain of the stale-conflict backlog: batch revalidation of unresolved
 * contradictions plus reversion of orphaned conflict entries. Detection and
 * single-pair resolution live in contradiction.ts — this module only schedules
 * them over the backlog at scale.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { sendAIMessage } from '../../utils/ai-client';
import { resolveContradiction } from './contradiction';

const log = createLogger('memory:contradiction-sweep');

/** Default per-night examination budget for drainStaleConflicts. */
const DEFAULT_SWEEP_BUDGET = 200;

/**
 * Read a positive integer budget from an env var, falling back on absence or
 * garbage — a malformed value must never disable the sweep.
 */
function envBudget(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Auto-revalidate one batch of stale conflicts so 'conflict' is a temporary
 * state, not a life sentence. Without this, conflict-marked entries (a third of
 * the KB at one point) stay trust-demoted (recall weight 0.5) forever unless a
 * human clicks resolve — the loop never recovers the knowledge it doubted.
 *
 * Resolution policy, cheapest evidence first:
 *  1. One side already dead (rejected/archived) → keep the other.
 *  2. Outcome evidence: a decayScore gap ≥ 0.3 (outcome reinforcement rewards
 *     entries whose tasks succeeded) → keep the stronger entry.
 *  3. LLM re-check: contradictions flagged long ago are often false positives
 *     — a NO_CONTRADICTION verdict dismisses (both back to validated).
 *  4. Still contested → leave unresolved (retried on a later sweep).
 *
 * @param limit - Max contradictions to examine in this batch. / 1バッチの処理上限
 * @param afterId - Cursor: only examine contradictions with id greater than
 *   this. Lets a drain loop skip still-contested pairs it already examined
 *   tonight instead of re-fetching the same stubborn ones. / 前バッチ最終IDカーソル
 * @returns Batch counts and the cursor for the next batch (null when the
 *   backlog past the cursor is empty). / 処理結果と次バッチ用カーソル
 */
export async function revalidateStaleConflicts(
  limit = 10,
  afterId = 0,
): Promise<{ examined: number; resolved: number; lastId: number | null }> {
  let resolved = 0;
  const contradictions = await prisma.knowledgeContradiction.findMany({
    where: { resolution: null, id: { gt: afterId } },
    include: { entryA: true, entryB: true },
    // NOTE: id-asc (not createdAt-asc) — ids are creation-ordered anyway, and a
    // unique monotonic sort key is what makes the afterId cursor correct.
    orderBy: { id: 'asc' },
    take: limit,
  });

  for (const c of contradictions) {
    try {
      const aDead =
        c.entryA.validationStatus === 'rejected' || c.entryA.forgettingStage === 'archived';
      const bDead =
        c.entryB.validationStatus === 'rejected' || c.entryB.forgettingStage === 'archived';

      if (aDead && bDead) {
        await resolveContradiction(c.id, 'dismiss');
        // Dismiss revalidates both — re-kill the dead ones so archived stays archived.
        await prisma.knowledgeEntry.updateMany({
          where: { id: { in: [c.entryAId, c.entryBId] } },
          data: { validationStatus: 'rejected' },
        });
        resolved++;
        continue;
      }
      if (aDead) {
        await resolveContradiction(c.id, 'keep_b');
        resolved++;
        continue;
      }
      if (bDead) {
        await resolveContradiction(c.id, 'keep_a');
        resolved++;
        continue;
      }

      const scoreGap = c.entryA.decayScore - c.entryB.decayScore;
      if (scoreGap >= 0.3) {
        await resolveContradiction(c.id, 'keep_a');
        resolved++;
        continue;
      }
      if (scoreGap <= -0.3) {
        await resolveContradiction(c.id, 'keep_b');
        resolved++;
        continue;
      }

      const response = await sendAIMessage({
        provider: 'ollama',
        messages: [
          {
            role: 'user',
            content: `以下の2つの知識エントリに本当に矛盾があるか再判定してください。

エントリA:
タイトル: ${c.entryA.title}
内容: ${c.entryA.content}

エントリB:
タイトル: ${c.entryB.title}
内容: ${c.entryB.content}

矛盾がある場合: 判定: CONTRADICTION
矛盾がない（両立できる/観点が違うだけ）場合: 判定: NO_CONTRADICTION`,
          },
        ],
        maxTokens: 128,
      });
      if (response.content.includes('NO_CONTRADICTION')) {
        await resolveContradiction(c.id, 'dismiss');
        resolved++;
      } else if (response.content.includes('CONTRADICTION')) {
        // A CONFIRMED contradiction is a testable claim, and the contradiction
        // ledger is the wrong venue for it: nothing here gets injected into
        // agent prompts, so the question would sit unanswered forever. The
        // hypothesis ledger IS the healthy loop (prompt injection → evidence →
        // graduation, human-reviewable on /hypotheses) — escalate there and
        // close this row so agents actively work the question instead.
        await escalateToHypothesis(c);
        resolved++;
      }
    } catch (error) {
      log.warn({ err: error, contradictionId: c.id }, 'Conflict revalidation failed for entry');
    }
  }

  const lastId = contradictions.length > 0 ? contradictions[contradictions.length - 1].id : null;
  return { examined: contradictions.length, resolved, lastId };
}

/** Contradiction row with both entries, as loaded by the sweep. */
interface SweepRow {
  id: number;
  entryAId: number;
  entryBId: number;
  entryA: { id: number; title: string; content: string };
  entryB: { id: number; title: string; content: string };
}

/**
 * Escalate a CONFIRMED contradiction into the hypothesis ledger and close the
 * contradiction row. The hypothesis statement embeds both K-ids so an agent
 * (or the user on /hypotheses) can trace and test the disagreement; its
 * verdict — not this ledger — becomes the authoritative resolution.
 *
 * @param c - The contested contradiction with both entries. / 係争中の矛盾
 */
async function escalateToHypothesis(c: SweepRow): Promise<void> {
  const { submitHypothesis } = await import('./hypothesis-service');
  const result = await submitHypothesis({
    statement:
      `K-${c.entryA.id}「${c.entryA.title}」とK-${c.entryB.id}「${c.entryB.title}」は矛盾しており、` +
      `K-${c.entryA.id}の主張の方が実際のコード/運用と整合している`,
    rationale:
      `矛盾検出LLMが2回の判定で矛盾を確認したペア。A:「${c.entryA.content.slice(0, 200)}」 ` +
      `B:「${c.entryB.content.slice(0, 200)}」。検証時はどちらの主張が実態と一致するかを ` +
      `file:line か実測で確認し、支持/反証の証拠を記録すること。`,
    source: 'contradiction_escalation',
  });

  if (!result.ok) {
    // Not falsifiable / duplicate hypothesis — still close the row (the claim
    // is already tracked); log so a pattern of rejections stays visible.
    log.warn(
      { contradictionId: c.id, reason: result.reason },
      '[contradiction-sweep] Hypothesis escalation rejected; closing row anyway',
    );
  }

  await prisma.knowledgeContradiction.update({
    where: { id: c.id },
    data: { resolution: 'escalated_to_hypothesis', resolvedAt: new Date() },
  });
  log.info(
    { contradictionId: c.id, entryAId: c.entryAId, entryBId: c.entryBId, filed: result.ok },
    '[contradiction-sweep] Contested contradiction escalated to the hypothesis ledger',
  );
}

/**
 * Revert orphaned conflict entries — marked 'conflict' but no unresolved
 * contradiction row references them (their pair was resolved/deleted, or the
 * validator marked them directly) — back to 'pending' so recall stops
 * trust-demoting knowledge nothing actually contests anymore.
 *
 * @returns Number of entries reverted to 'pending'. / pendingへ復帰した件数
 */
export async function revertOrphanedConflicts(): Promise<number> {
  const orphans = await prisma.knowledgeEntry.updateMany({
    where: {
      validationStatus: 'conflict',
      contradictions: { none: { resolution: null } },
      contradictedBy: { none: { resolution: null } },
    },
    data: { validationStatus: 'pending' },
  });
  return orphans.count;
}

/**
 * Drain the stale-conflict backlog in cursor-batched sweeps until it is empty
 * or the nightly budget is spent, then revert orphaned conflict entries.
 *
 * NOTE: A fixed 10/night cap let the backlog grow faster than it drained
 * (hundreds of open conflicts vs. ~10 resolutions/day) — the cursor lets one
 * night examine every open pair up to the budget without re-fetching pairs
 * that stayed contested earlier the same night.
 *
 * @param options.batchSize - Contradictions per DB fetch. / 1バッチの取得件数
 * @param options.maxExamined - Nightly examination budget; defaults to
 *   RAPITAS_KB_CONFLICT_SWEEP_BUDGET or 200. / 一晩の処理上限
 * @returns Aggregate counts across all batches. / 全バッチ合計の処理結果
 */
export async function drainStaleConflicts(options?: {
  batchSize?: number;
  maxExamined?: number;
}): Promise<{ examined: number; resolved: number; orphansReverted: number }> {
  const batchSize = options?.batchSize ?? 25;
  const maxExamined =
    options?.maxExamined ?? envBudget('RAPITAS_KB_CONFLICT_SWEEP_BUDGET', DEFAULT_SWEEP_BUDGET);

  let examined = 0;
  let resolved = 0;
  let cursor = 0;

  while (examined < maxExamined) {
    const batch = await revalidateStaleConflicts(
      Math.min(batchSize, maxExamined - examined),
      cursor,
    );
    examined += batch.examined;
    resolved += batch.resolved;
    if (batch.lastId === null) break; // backlog past the cursor is empty
    cursor = batch.lastId;
  }

  const orphansReverted = await revertOrphanedConflicts();

  if (examined > 0 || orphansReverted > 0) {
    log.info({ examined, resolved, orphansReverted }, 'Stale-conflict drain finished');
  }
  return { examined, resolved, orphansReverted };
}
