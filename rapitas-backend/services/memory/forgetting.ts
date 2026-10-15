/**
 * Three-stage Forgetting System
 *
 * active (decayScore >= 0.5) -> dormant (0.1 <= score < 0.5) -> archived (score < 0.1)
 *
 * Decay per sweep: decayScore * r ^ ((2 - confidence) * daysSinceLastDecay),
 * r = RAPITAS_KB_DECAY_DAILY_RETENTION (default 0.95). Each sweep applies only
 * the interval since the PREVIOUS sweep (lastDecayAt), so decay never compounds
 * across sweeps; lastAccessedAt is deliberately not a reference date — access
 * protection is the job of boostDecayOnAccess (+delta), not of the formula.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { appendEvent } from './timeline';

const log = createLogger('memory:forgetting');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Per-day retention factor for confidence 1.0 (0.95 = lose 5 %/day).
 * Restricted to (0.5, 1) — anything else is a config error and reverts.
 */
const DAILY_RETENTION = (() => {
  const v = parseFloat(process.env.RAPITAS_KB_DECAY_DAILY_RETENTION ?? '0.95');
  return Number.isFinite(v) && v > 0.5 && v < 1 ? v : 0.95;
})();

/**
 * Calculate the decay score after one sweep.
 *
 * NOTE: the previous formula used `lastAccessedAt ?? lastDecayAt` as the
 * reference date and multiplied by `(0.5 + confidence*0.5)` EVERY sweep. Both
 * compounded nightly, so an entry that had once been accessed (and boosted)
 * reached `archived` in ~10 nights while a never-accessed one took ~45 — the
 * opposite of what reinforcement intends. The new formula folds confidence
 * into the exponent instead: confidence 1.0 decays at r/day, 0 at r²/day.
 *
 * @param currentDecay - Current decayScore (0..1). / 現在の減衰スコア
 * @param confidence - Entry confidence (0..1). / 信頼度
 * @param lastDecayAt - When the previous sweep ran. / 前回スイープ時刻
 * @param now - Reference time (injectable for tests). / 現在時刻
 * @returns New decayScore clamped to 0..1. / 新しい減衰スコア
 */
export function calculateDecay(
  currentDecay: number,
  confidence: number,
  lastDecayAt: Date,
  now: Date = new Date(),
): number {
  const daysSince = Math.max(0, (now.getTime() - lastDecayAt.getTime()) / DAY_MS);
  const conf = Math.max(0, Math.min(1, confidence));
  const decay = currentDecay * Math.pow(DAILY_RETENTION, (2 - conf) * daysSince);
  return Math.max(0, Math.min(1, decay));
}

/**
 * Determine forgetting stage from decay score.
 */
function determineStage(decayScore: number): 'active' | 'dormant' | 'archived' {
  if (decayScore >= 0.5) return 'active';
  if (decayScore >= 0.1) return 'dormant';
  return 'archived';
}

/**
 * Run a forgetting sweep.
 *
 * Updates decay scores for all active/dormant entries and transitions their stages.
 */
export async function runForgettingSweep(): Promise<{
  processed: number;
  transitioned: { toDormant: number; toArchived: number };
}> {
  const entries = await prisma.knowledgeEntry.findMany({
    where: {
      forgettingStage: { in: ['active', 'dormant'] },
    },
    select: {
      id: true,
      decayScore: true,
      confidence: true,
      lastAccessedAt: true,
      lastDecayAt: true,
      forgettingStage: true,
      pinnedUntil: true,
    },
  });

  // Skip pinned entries (pinnedUntil in the future)
  const now = new Date();
  const processable = entries.filter((e) => !e.pinnedUntil || e.pinnedUntil <= now);

  let toDormant = 0;
  let toArchived = 0;

  for (const entry of processable) {
    const newDecay = calculateDecay(entry.decayScore, entry.confidence, entry.lastDecayAt, now);
    const newStage = determineStage(newDecay);
    const stageChanged = newStage !== entry.forgettingStage;

    if (stageChanged) {
      if (newStage === 'dormant') toDormant++;
      if (newStage === 'archived') toArchived++;
    }

    await prisma.knowledgeEntry.update({
      where: { id: entry.id },
      data: {
        decayScore: newDecay,
        lastDecayAt: now,
        forgettingStage: newStage,
      },
    });
  }

  await appendEvent({
    eventType: 'forgetting_sweep',
    payload: {
      processed: processable.length,
      toDormant,
      toArchived,
    },
  });

  log.info({ processed: processable.length, toDormant, toArchived }, 'Forgetting sweep completed');

  return {
    processed: processable.length,
    transitioned: { toDormant, toArchived },
  };
}

/**
 * Boost decay score on access: min(1.0, current + delta).
 *
 * The `delta` lets callers express signal strength: a bare retrieval is a WEAK
 * signal (use a small delta), whereas a knowledge entry that demonstrably
 * contributed to a SUCCESSFUL task outcome is a STRONG reward (the default 0.3).
 * This is the long-term-potentiation half of outcome-gated reinforcement —
 * memories that keep helping survive; those merely retrieved barely move.
 *
 * @param entryId - Knowledge entry to reinforce. / 強化対象のナレッジID
 * @param delta - How much to raise decayScore (default 0.3). / 上げ幅
 */
export async function boostDecayOnAccess(entryId: number, delta = 0.3): Promise<void> {
  const entry = await prisma.knowledgeEntry.findUnique({
    where: { id: entryId },
    select: { decayScore: true },
  });

  if (!entry) return;

  const newDecay = Math.min(1.0, entry.decayScore + delta);
  const newStage = determineStage(newDecay);

  await prisma.knowledgeEntry.update({
    where: { id: entryId },
    data: {
      decayScore: newDecay,
      forgettingStage: newStage,
      accessCount: { increment: 1 },
      lastAccessedAt: new Date(),
    },
  });
}

/**
 * Penalize a knowledge entry whose retrieval preceded a FAILED task outcome:
 * lower its decayScore (it fades faster) so knowledge that leads to bad results
 * is selected against. The negative half of outcome-gated reinforcement — the
 * "this didn't help" signal. accessCount is NOT bumped (a failure is not a
 * useful access). Never drops below 0.
 *
 * @param entryId - Knowledge entry to penalize. / 減衰させるナレッジID
 * @param delta - How much to lower decayScore (default 0.2). / 下げ幅
 */
export async function penalizeOnFailure(entryId: number, delta = 0.2): Promise<void> {
  const entry = await prisma.knowledgeEntry.findUnique({
    where: { id: entryId },
    select: { decayScore: true },
  });
  if (!entry) return;

  const newDecay = Math.max(0, entry.decayScore - delta);
  await prisma.knowledgeEntry.update({
    where: { id: entryId },
    data: { decayScore: newDecay, forgettingStage: determineStage(newDecay) },
  });
}
