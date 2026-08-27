/**
 * decision-ledger/knowledge-usefulness
 *
 * Answers "when this knowledge was put in front of an agent, did the agent use
 * it?" from the settled recall decisions.
 *
 * Distinct from the signal the recall ranking already used, which was the
 * outcome of the task that PRODUCED an entry. That says the entry came from a
 * run that went well; it says nothing about whether the entry has ever helped
 * anyone since. This is the causal half.
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { ENTRY_USAGE_ACTION } from './settle-knowledge';

const log = createLogger('decision-ledger:knowledge-usefulness');

/** One entry's track record across the recalls that injected it. */
export interface EntryUsefulness {
  /** Times the entry was put into an agent's context. */
  injected: number;
  /** Of those, times the agent declared using it. */
  used: number;
  /** used / injected. */
  rate: number;
}

/** Below this many observations the rate is noise and callers should ignore it. */
export const MIN_OBSERVATIONS = 3;

/** How far back to look. Older usage says little about current relevance. */
const WINDOW_DAYS = 30;

/**
 * Per-entry usefulness for the given ids.
 *
 * Entries with no record are simply absent from the map — a new entry is not a
 * useless one, and callers must not treat silence as a low score.
 *
 * @param entryIds - Knowledge entry ids to look up. / 対象のナレッジID
 * @returns Map of entry id to its record. / IDごとの実績
 */
export async function knowledgeUsefulness(
  entryIds: number[],
): Promise<Map<number, EntryUsefulness>> {
  const out = new Map<number, EntryUsefulness>();
  if (entryIds.length === 0) return out;
  try {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const rows = await prisma.activityLog.findMany({
      where: { action: ENTRY_USAGE_ACTION, createdAt: { gte: since } },
      select: { metadata: true },
      orderBy: { id: 'desc' },
      take: 5000,
    });

    const wanted = new Set(entryIds);
    for (const row of rows) {
      let parsed: { entryId?: unknown; used?: unknown };
      try {
        parsed = JSON.parse(row.metadata ?? '{}') as typeof parsed;
      } catch {
        continue;
      }
      const id = typeof parsed.entryId === 'number' ? parsed.entryId : null;
      if (id === null || !wanted.has(id)) continue;
      const acc = out.get(id) ?? { injected: 0, used: 0, rate: 0 };
      acc.injected += 1;
      if (parsed.used === true) acc.used += 1;
      acc.rate = acc.used / acc.injected;
      out.set(id, acc);
    }
    return out;
  } catch (err) {
    log.warn({ err }, '[knowledge-usefulness] lookup failed — ranking falls back');
    return out;
  }
}
