/**
 * Knowledge Validation
 *
 * Stage 1: Heuristic (hash duplicate detection, cosine similarity)
 * Stage 2: LLM (consistency judgment)
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { sendAIMessage } from '../../utils/ai-client';
import { vectorSearch } from './rag/search';

const log = createLogger('memory:validation');

/**
 * Validate a knowledge entry against duplicates and conflicts.
 */
export async function validateEntry(entryId: number): Promise<{
  status: 'validated' | 'rejected' | 'conflict';
  reason: string;
  duplicateOf?: number;
}> {
  const entry = await prisma.knowledgeEntry.findUnique({
    where: { id: entryId },
  });

  if (!entry) {
    throw new Error(`KnowledgeEntry not found: ${entryId}`);
  }

  // Stage 1: Heuristic - exact duplicate detection by contentHash
  const duplicateByHash = await prisma.knowledgeEntry.findFirst({
    where: {
      contentHash: entry.contentHash,
      id: { not: entryId },
    },
  });

  if (duplicateByHash) {
    await prisma.knowledgeEntry.update({
      where: { id: entryId },
      data: {
        validationStatus: 'rejected',
        validatedAt: new Date(),
        validationMethod: 'hash_duplicate',
      },
    });
    log.info({ entryId, duplicateOf: duplicateByHash.id }, 'Entry rejected: hash duplicate');
    return {
      status: 'rejected',
      reason: '完全な重複エントリが存在します',
      duplicateOf: duplicateByHash.id,
    };
  }

  // Stage 1: Cosine similarity duplicate check
  try {
    const searchResults = await vectorSearch({
      query: entry.content,
      limit: 5,
      minSimilarity: 0.7,
    });

    // Exclude self
    const similarEntries = searchResults.filter((r) => r.knowledgeEntryId !== entryId);

    if (similarEntries.length > 0) {
      const topMatch = similarEntries[0];

      if (topMatch.similarity > 0.92) {
        // Very high similarity: reject as duplicate
        await prisma.knowledgeEntry.update({
          where: { id: entryId },
          data: {
            validationStatus: 'rejected',
            validatedAt: new Date(),
            validationMethod: 'vector_duplicate',
          },
        });
        log.info(
          { entryId, duplicateOf: topMatch.knowledgeEntryId, similarity: topMatch.similarity },
          'Entry rejected: vector duplicate',
        );
        return {
          status: 'rejected',
          reason: `類似度${(topMatch.similarity * 100).toFixed(1)}%の重複エントリが存在します`,
          duplicateOf: topMatch.knowledgeEntryId,
        };
      }

      // Stage 2: For similarity 0.7-0.92, use LLM for consistency check
      const similarEntry = await prisma.knowledgeEntry.findUnique({
        where: { id: topMatch.knowledgeEntryId },
      });

      if (similarEntry) {
        try {
          const response = await sendAIMessage({
            provider: 'ollama',
            messages: [
              {
                role: 'user',
                content: `以下の2つの知識エントリが整合しているか判定してください。

エントリA:
タイトル: ${entry.title}
内容: ${entry.content}

エントリB:
タイトル: ${similarEntry.title}
内容: ${similarEntry.content}

以下のいずれかで回答してください:
- CONSISTENT: 整合している（両方とも正しい、補完関係）
- DUPLICATE: 実質的に同じ内容
- CONFLICT: 矛盾している

判定: [CONSISTENT/DUPLICATE/CONFLICT]
理由: [簡潔な理由]`,
              },
            ],
            maxTokens: 256,
          });

          const responseText = response.content;

          if (responseText.includes('DUPLICATE')) {
            await prisma.knowledgeEntry.update({
              where: { id: entryId },
              data: {
                validationStatus: 'rejected',
                validatedAt: new Date(),
                validationMethod: 'llm_duplicate',
              },
            });
            return {
              status: 'rejected',
              reason: 'LLM判定: 実質的な重複',
              duplicateOf: topMatch.knowledgeEntryId,
            };
          }

          if (responseText.includes('CONFLICT')) {
            await prisma.knowledgeEntry.update({
              where: { id: entryId },
              data: {
                validationStatus: 'conflict',
                validatedAt: new Date(),
                validationMethod: 'llm_conflict',
              },
            });
            return { status: 'conflict', reason: 'LLM判定: 既存エントリと矛盾' };
          }
        } catch (error) {
          log.warn({ err: error, entryId }, 'LLM validation failed, accepting entry');
        }
      }
    }
  } catch (error) {
    // Skip if vector search is unavailable
    log.debug({ err: error, entryId }, 'Vector search unavailable for validation');
  }

  // Validation passed
  await prisma.knowledgeEntry.update({
    where: { id: entryId },
    data: {
      validationStatus: 'validated',
      validatedAt: new Date(),
      validationMethod: 'auto',
    },
  });

  log.debug({ entryId }, 'Entry validated');
  return { status: 'validated', reason: '検証通過' };
}
