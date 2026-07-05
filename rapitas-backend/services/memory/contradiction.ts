/**
 * Contradiction Detection & Resolution
 *
 * Detects contradictions between new/updated entries and similar existing entries,
 * and provides resolution options.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { sendAIMessage } from '../../utils/ai-client';
import { vectorSearch } from './rag/search';
import { appendEvent } from './timeline';
import type { ContradictionResolution } from './types';

const log = createLogger('memory:contradiction');

/**
 * Detect contradictions for a new or updated entry.
 *
 * @param entryId - Knowledge entry ID to check
 * @returns Number of contradictions detected
 */
export async function detectContradictions(entryId: number): Promise<number> {
  const entry = await prisma.knowledgeEntry.findUnique({
    where: { id: entryId },
  });

  if (!entry) return 0;

  let detectCount = 0;

  try {
    // Retrieve top-10 similar entries
    const searchResults = await vectorSearch({
      query: entry.content,
      limit: 10,
      minSimilarity: 0.6,
    });

    // Exclude self
    const candidates = searchResults.filter((r) => r.knowledgeEntryId !== entryId);

    for (const candidate of candidates) {
      // Check for existing contradiction record
      const existing = await prisma.knowledgeContradiction.findFirst({
        where: {
          OR: [
            { entryAId: entryId, entryBId: candidate.knowledgeEntryId },
            { entryAId: candidate.knowledgeEntryId, entryBId: entryId },
          ],
        },
      });
      if (existing) continue;

      const candidateEntry = await prisma.knowledgeEntry.findUnique({
        where: { id: candidate.knowledgeEntryId },
      });
      if (!candidateEntry) continue;

      // Determine contradiction via LLM
      try {
        const response = await sendAIMessage({
          provider: 'ollama',
          messages: [
            {
              role: 'user',
              content: `以下の2つの知識エントリに矛盾がないか判定してください。

エントリA:
タイトル: ${entry.title}
内容: ${entry.content}

エントリB:
タイトル: ${candidateEntry.title}
内容: ${candidateEntry.content}

矛盾がある場合は以下の形式で回答:
判定: CONTRADICTION
種類: [factual/procedural/preference]
説明: [矛盾の内容]

矛盾がない場合:
判定: NO_CONTRADICTION`,
            },
          ],
          maxTokens: 256,
        });

        const responseText = response.content;
        if (responseText.includes('CONTRADICTION')) {
          const typeMatch = responseText.match(/種類:\s*(factual|procedural|preference)/);
          const descMatch = responseText.match(/説明:\s*(.+)/);

          const contradiction = await prisma.knowledgeContradiction.create({
            data: {
              entryAId: entryId,
              entryBId: candidate.knowledgeEntryId,
              contradictionType: typeMatch?.[1] ?? 'factual',
              description: descMatch?.[1]?.trim(),
            },
          });

          // Mark both entries as conflicting
          await prisma.knowledgeEntry.updateMany({
            where: { id: { in: [entryId, candidate.knowledgeEntryId] } },
            data: { validationStatus: 'conflict' },
          });

          await appendEvent({
            eventType: 'contradiction_detected',
            payload: {
              contradictionId: contradiction.id,
              entryAId: entryId,
              entryBId: candidate.knowledgeEntryId,
              type: contradiction.contradictionType,
            },
          });

          detectCount++;
          log.info(
            {
              contradictionId: contradiction.id,
              entryAId: entryId,
              entryBId: candidate.knowledgeEntryId,
            },
            'Contradiction detected',
          );
        }
      } catch (error) {
        log.warn(
          { err: error, entryId, candidateId: candidate.knowledgeEntryId },
          'LLM contradiction check failed',
        );
      }
    }
  } catch (error) {
    log.debug({ err: error, entryId }, 'Vector search unavailable for contradiction detection');
  }

  return detectCount;
}

/**
 * Resolve a detected contradiction.
 *
 * @param contradictionId - Contradiction record ID
 * @param resolution - Resolution strategy (keep_a, keep_b, merge, dismiss)
 */
export async function resolveContradiction(
  contradictionId: number,
  resolution: ContradictionResolution,
): Promise<void> {
  const contradiction = await prisma.knowledgeContradiction.findUnique({
    where: { id: contradictionId },
    include: { entryA: true, entryB: true },
  });

  if (!contradiction) {
    throw new Error(`Contradiction not found: ${contradictionId}`);
  }

  switch (resolution) {
    case 'keep_a':
      await prisma.knowledgeEntry.update({
        where: { id: contradiction.entryBId },
        data: { forgettingStage: 'archived', validationStatus: 'rejected' },
      });
      break;
    case 'keep_b':
      await prisma.knowledgeEntry.update({
        where: { id: contradiction.entryAId },
        data: { forgettingStage: 'archived', validationStatus: 'rejected' },
      });
      break;
    case 'merge':
      // Merge: mark both as validated
      await prisma.knowledgeEntry.updateMany({
        where: { id: { in: [contradiction.entryAId, contradiction.entryBId] } },
        data: { validationStatus: 'validated' },
      });
      break;
    case 'dismiss':
      // Dismiss: revert both to validated
      await prisma.knowledgeEntry.updateMany({
        where: { id: { in: [contradiction.entryAId, contradiction.entryBId] } },
        data: { validationStatus: 'validated' },
      });
      break;
  }

  await prisma.knowledgeContradiction.update({
    where: { id: contradictionId },
    data: { resolution, resolvedAt: new Date() },
  });

  await appendEvent({
    eventType: 'contradiction_resolved',
    payload: { contradictionId, resolution },
  });

  log.info({ contradictionId, resolution }, 'Contradiction resolved');
}

/**
 * Auto-revalidate stale conflicts so 'conflict' is a temporary state, not a
 * life sentence. Without this, conflict-marked entries (a third of the KB at
 * one point) stay trust-demoted (recall weight 0.5) forever unless a human
 * clicks resolve — the loop never recovers the knowledge it doubted.
 *
 * Resolution policy, cheapest evidence first:
 *  1. One side already dead (rejected/archived) → keep the other.
 *  2. Outcome evidence: a decayScore gap ≥ 0.3 (outcome reinforcement rewards
 *     entries whose tasks succeeded) → keep the stronger entry.
 *  3. LLM re-check: contradictions flagged long ago are often false positives
 *     — a NO_CONTRADICTION verdict dismisses (both back to validated).
 *  4. Still contested → leave unresolved (retried on a later sweep).
 *
 * @param limit - Max contradictions to examine per sweep. / 1回の処理上限
 * @returns Counts of auto-resolved and still-open contradictions. / 処理結果
 */
export async function revalidateStaleConflicts(
  limit = 10,
): Promise<{ examined: number; resolved: number }> {
  let resolved = 0;
  const contradictions = await prisma.knowledgeContradiction.findMany({
    where: { resolution: null },
    include: { entryA: true, entryB: true },
    orderBy: { createdAt: 'asc' },
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
      }
    } catch (error) {
      log.warn({ err: error, contradictionId: c.id }, 'Conflict revalidation failed for entry');
    }
  }

  // Orphaned conflict entries — marked 'conflict' but no unresolved
  // contradiction row references them (their pair was resolved/deleted, or the
  // validator marked them directly). Return them to 'pending' so recall stops
  // trust-demoting knowledge nothing actually contests anymore.
  const orphans = await prisma.knowledgeEntry.updateMany({
    where: {
      validationStatus: 'conflict',
      contradictions: { none: { resolution: null } },
      contradictedBy: { none: { resolution: null } },
    },
    data: { validationStatus: 'pending' },
  });

  if (resolved > 0 || orphans.count > 0) {
    log.info(
      { examined: contradictions.length, resolved, orphansReverted: orphans.count },
      'Stale-conflict revalidation sweep finished',
    );
  }
  return { examined: contradictions.length, resolved };
}

/**
 * Retrieve unresolved contradictions.
 */
export async function getUnresolvedContradictions(limit = 20) {
  return prisma.knowledgeContradiction.findMany({
    where: { resolution: null },
    include: {
      entryA: {
        select: { id: true, title: true, content: true, category: true, confidence: true },
      },
      entryB: {
        select: { id: true, title: true, content: true, category: true, confidence: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
