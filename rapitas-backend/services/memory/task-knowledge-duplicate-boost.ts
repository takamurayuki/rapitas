/**
 * Task Knowledge Duplicate Boost
 *
 * Cooldown-gated decay boost for a knowledge entry that a newly extracted item
 * duplicates. Split out of task-knowledge-extractor.ts so that file stays
 * within its line-limit ratchet baseline; not responsible for deciding what
 * counts as a duplicate (see dedup.ts).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { boostDecayOnAccess } from './forgetting';

const log = createLogger('memory:task-knowledge');

/** Window within which a repeat duplicate-boost on the same entry is skipped. */
export const DUPLICATE_BOOST_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Boost an entry on a near-duplicate hit, but skip it when the entry was already
 * accessed within the cooldown window. Re-extraction / paraphrase reruns within
 * a short span are extraction artifacts, not repeated real use — boosting on
 * each one inflates the decay score with no evidence the knowledge helped.
 * `boostDecayOnAccess` itself stamps `lastAccessedAt`, so the window is
 * self-maintaining across calls.
 *
 * @param dupId - Existing entry the new item duplicates. / 重複先エントリID
 * @param delta - Boost magnitude to apply when not in cooldown. / 加点幅
 */
export async function boostDuplicateWithCooldown(dupId: number, delta: number): Promise<void> {
  const existing = await prisma.knowledgeEntry
    .findUnique({ where: { id: dupId }, select: { lastAccessedAt: true } })
    .catch(() => null);
  const last = existing?.lastAccessedAt;
  if (last && Date.now() - last.getTime() < DUPLICATE_BOOST_COOLDOWN_MS) {
    log.debug({ dupId }, 'duplicate_boost_skipped_cooldown');
    return;
  }
  await boostDecayOnAccess(dupId, delta).catch(() => {});
}
