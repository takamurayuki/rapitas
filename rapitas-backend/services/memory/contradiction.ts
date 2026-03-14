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
