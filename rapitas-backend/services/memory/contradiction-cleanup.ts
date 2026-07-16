/**
 * ContradictionCleanup
 *
 * Bulk, LLM-free triage of the open-contradiction backlog. Applies only the
 * cheap deterministic rules (near-duplicate pair → dedup, dead side → keep
 * survivor, decayScore gap → keep the outcome-proven side) and leaves
 * genuinely contested pairs for the nightly LLM drain. Pure decision core —
 * DB application lives in scripts/cleanup-contradiction-backlog.ts.
 */
import { isNearDuplicatePair } from './text-similarity';

/** Entry fields the cleanup rules need. */
export interface CleanupEntry {
  id: number;
  title: string;
  content: string;
  decayScore: number;
  validationStatus: string;
  forgettingStage: string;
}

/** One open contradiction row with both entries loaded. */
export interface CleanupRow {
  id: number;
  entryA: CleanupEntry;
  entryB: CleanupEntry;
}

/** Bulk decisions, grouped so application needs one updateMany per group. */
export interface CleanupDecisions {
  keepA: number[];
  keepB: number[];
  dismiss: number[];
  /** Entries to mark rejected+archived (dedup/score losers). */
  rejectEntryIds: number[];
  /** Contradiction ids left open for the nightly LLM drain. */
  contested: number[];
}

/** decayScore advantage at/above which the stronger entry wins outright. */
const SCORE_GAP = 0.3;

/**
 * Decide bulk resolutions for open contradictions. Iterates until stable so a
 * dedup loss in one pair cascades into dead-side resolutions of that entry's
 * OTHER pairs within the same pass (without this, clearing an N-duplicate
 * cluster would need N nightly sweeps).
 *
 * @param rows - Open contradictions with both entries. / 未解決矛盾
 * @returns Grouped decisions ready for batched application. / 一括適用用の判定
 */
export function decideBulkCleanup(rows: CleanupRow[]): CleanupDecisions {
  const decisions: CleanupDecisions = {
    keepA: [],
    keepB: [],
    dismiss: [],
    rejectEntryIds: [],
    contested: [],
  };

  const dead = new Set<number>();
  for (const row of rows) {
    for (const e of [row.entryA, row.entryB]) {
      if (e.validationStatus === 'rejected' || e.forgettingStage === 'archived') dead.add(e.id);
    }
  }

  const undecided = new Map(rows.map((r) => [r.id, r]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, row] of undecided) {
      const aDead = dead.has(row.entryA.id);
      const bDead = dead.has(row.entryB.id);

      if (aDead && bDead) {
        decisions.dismiss.push(id);
      } else if (aDead) {
        decisions.keepB.push(id);
      } else if (bDead) {
        decisions.keepA.push(id);
      } else if (isNearDuplicatePair(row.entryA, row.entryB)) {
        // Same lesson reworded — dedup: keep the outcome-proven side
        // (higher decayScore; tie → the older entry).
        const keepA =
          row.entryA.decayScore > row.entryB.decayScore ||
          (row.entryA.decayScore === row.entryB.decayScore && row.entryA.id < row.entryB.id);
        const loser = keepA ? row.entryB : row.entryA;
        decisions[keepA ? 'keepA' : 'keepB'].push(id);
        decisions.rejectEntryIds.push(loser.id);
        dead.add(loser.id);
      } else if (Math.abs(row.entryA.decayScore - row.entryB.decayScore) >= SCORE_GAP) {
        const keepA = row.entryA.decayScore > row.entryB.decayScore;
        const loser = keepA ? row.entryB : row.entryA;
        decisions[keepA ? 'keepA' : 'keepB'].push(id);
        decisions.rejectEntryIds.push(loser.id);
        dead.add(loser.id);
      } else {
        continue; // stays undecided this iteration
      }
      undecided.delete(id);
      changed = true;
    }
  }

  decisions.contested = [...undecided.keys()];
  decisions.rejectEntryIds = [...new Set(decisions.rejectEntryIds)];
  return decisions;
}
