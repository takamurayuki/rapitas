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
import { isNearDuplicatePair } from './text-similarity';
import { appendEvent } from './timeline';
import type { ContradictionResolution } from './types';

const log = createLogger('memory:contradiction');

/** Max open contradictions one entry may accumulate before we stop adding more. */
const MAX_OPEN_PER_ENTRY = (() => {
  const v = parseInt(process.env.RAPITAS_KB_MAX_OPEN_CONTRADICTIONS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 3;
})();

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

    // Cap: an entry buried under open contradictions gains nothing from more —
    // each additional pair repeats the same "this cluster disagrees" signal
    // while inflating the backlog the nightly drain must chew through.
    let openCount = await prisma.knowledgeContradiction.count({
      where: {
        resolution: null,
        OR: [{ entryAId: entryId }, { entryBId: entryId }],
      },
    });

    for (const candidate of candidates) {
      if (openCount >= MAX_OPEN_PER_ENTRY) {
        log.debug(
          { entryId, openCount },
          '[contradiction] Open-contradiction cap reached — skipping further pairs',
        );
        break;
      }

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

      // Near-duplicate pair = same lesson reworded — dedup it here instead of
      // asking the LLM, which reliably misreads paraphrase deltas as
      // "contradictions". Keep the outcome-proven side (decayScore, then age).
      if (isNearDuplicatePair(entry, candidateEntry)) {
        const keepCandidate =
          candidateEntry.decayScore > entry.decayScore ||
          (candidateEntry.decayScore === entry.decayScore && candidateEntry.id < entry.id);
        const loserId = keepCandidate ? entry.id : candidateEntry.id;
        await prisma.knowledgeEntry.update({
          where: { id: loserId },
          data: { validationStatus: 'rejected', forgettingStage: 'archived' },
        });
        await appendEvent({
          eventType: 'knowledge_archived',
          payload: {
            entryId: loserId,
            keptEntryId: keepCandidate ? candidateEntry.id : entry.id,
            reason: 'near_duplicate_dedup',
          },
        });
        log.info(
          { entryId: loserId, keptEntryId: keepCandidate ? candidateEntry.id : entry.id },
          '[contradiction] Near-duplicate pair deduped instead of contradiction-flagged',
        );
        // The new entry lost the dedup — no point checking further candidates.
        if (loserId === entryId) break;
        continue;
      }

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
        // "NO_CONTRADICTION" contains the substring "CONTRADICTION" — check the
        // negative form first, or a plain includes() misreads every negative
        // verdict as positive and the caller registers a row it shouldn't.
        if (responseText.includes('NO_CONTRADICTION')) {
          log.debug(
            { entryId, candidateId: candidate.knowledgeEntryId },
            '[contradiction] LLM judged NO_CONTRADICTION — skipping record',
          );
        } else if (responseText.includes('CONTRADICTION')) {
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
          openCount++;
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

// NOTE: revalidateStaleConflicts / drainStaleConflicts moved to
// ./contradiction-sweep.ts — this file was past the 300-line split threshold,
// and the nightly backlog drain is a separate concern from detection/resolution.

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
