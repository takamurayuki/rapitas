/**
 * Knowledge Reconsolidation
 *
 * Updates existing knowledge based on prediction errors.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { sendAIMessage } from '../../utils/ai-client';
import { appendEvent } from './timeline';
import { createContentHash } from './utils';

const log = createLogger('memory:reconsolidation');

/**
 * Detect prediction errors and reconsolidate knowledge.
 *
 * errorMagnitude > 0.3: Update knowledge via LLM + re-embed.
 * errorMagnitude <= 0.3: Slightly reduce confidence only.
 */
export async function triggerReconsolidation(params: {
  entryId: number;
  predictionError: string;
  errorMagnitude: number;
  triggerSource?: string;
}): Promise<{ reconsolidationId: number; updated: boolean }> {
  const { entryId, predictionError, errorMagnitude, triggerSource } = params;

  const entry = await prisma.knowledgeEntry.findUnique({
    where: { id: entryId },
  });

  if (!entry) {
    throw new Error(`KnowledgeEntry not found: ${entryId}`);
  }

  const previousContent = entry.content;
  let newContent = entry.content;
  let updated = false;

  if (errorMagnitude > 0.3) {
    // Large prediction error: update knowledge via LLM
    try {
      const response = await sendAIMessage({
        messages: [
          {
            role: 'user',
            content: `以下の知識エントリが予測誤差により更新が必要です。

現在の知識:
タイトル: ${entry.title}
内容: ${entry.content}

予測誤差:
${predictionError}

誤差の大きさ: ${errorMagnitude}

予測誤差を反映して、知識の内容を更新してください。
更新後の内容のみを出力してください。`,
          },
        ],
        maxTokens: 1024,
      });

      newContent = response.content.trim();

      await prisma.knowledgeEntry.update({
        where: { id: entryId },
        data: {
          content: newContent,
          contentHash: createContentHash(newContent),
          confidence: Math.max(0.1, entry.confidence - 0.1),
          validationStatus: 'pending',
        },
      });

      updated = true;
      log.info({ entryId, errorMagnitude }, 'Knowledge reconsolidated with LLM update');
    } catch (error) {
      log.error({ err: error, entryId }, 'Failed to reconsolidate with LLM');
      // Fallback: slightly reduce confidence only
      await prisma.knowledgeEntry.update({
        where: { id: entryId },
        data: { confidence: Math.max(0.1, entry.confidence - 0.05) },
      });
    }
  } else {
    // Small prediction error: slightly reduce confidence only
    await prisma.knowledgeEntry.update({
      where: { id: entryId },
      data: { confidence: Math.max(0.1, entry.confidence - 0.05) },
    });
    log.debug({ entryId, errorMagnitude }, 'Knowledge confidence slightly reduced');
  }

  // Create reconsolidation record
  const record = await prisma.knowledgeReconsolidation.create({
    data: {
      entryId,
      predictionError,
      errorMagnitude,
      previousContent,
      newContent,
      triggerSource,
    },
  });

  await appendEvent({
    eventType: 'reconsolidation_triggered',
    payload: {
      entryId,
      reconsolidationId: record.id,
      errorMagnitude,
      updated,
    },
  });

  return { reconsolidationId: record.id, updated };
}
