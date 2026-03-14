/**
 * Knowledge Consolidation
 *
 * Groups KnowledgeEntries from the last 24 hours by category + theme,
 * then uses LLM to summarize and create consolidated entries.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { sendAIMessage } from '../../utils/ai-client';
import { appendEvent } from './timeline';
import { createContentHash } from './utils';

const log = createLogger('memory:consolidation');

/**
 * Run the consolidation process.
 *
 * Groups entries by category + themeId and summarizes groups with 3+ entries via LLM.
 *
 * @returns Run ID, processed/merged/created counts
 */
export async function runConsolidation(): Promise<{
  runId: number;
  processed: number;
  merged: number;
  created: number;
}> {
  const run = await prisma.consolidationRun.create({
    data: { runDate: new Date(), status: 'running' },
  });

  await appendEvent({
    eventType: 'consolidation_started',
    payload: { runId: run.id },
  });

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Fetch active entries from the last 24 hours
    const entries = await prisma.knowledgeEntry.findMany({
      where: {
        createdAt: { gte: since },
        forgettingStage: 'active',
        sourceType: { not: 'consolidated' },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group by category + themeId
    const groups = new Map<string, typeof entries>();
    for (const entry of entries) {
      const key = `${entry.category}:${entry.themeId ?? 'null'}`;
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }

    let totalProcessed = 0;
    let totalMerged = 0;
    let totalCreated = 0;

    for (const [key, groupEntries] of groups) {
      if (groupEntries.length < 3) continue;

      totalProcessed += groupEntries.length;

      try {
        const [category, themeIdStr] = key.split(':');
        const themeId = themeIdStr === 'null' ? null : parseInt(themeIdStr, 10);

        // Generate summary via LLM
        const entrySummaries = groupEntries
          .map((e, i) => `[${i + 1}] ${e.title}: ${e.content}`)
          .join('\n\n');

        const response = await sendAIMessage({
          messages: [
            {
              role: 'user',
              content: `以下の${groupEntries.length}件の知識エントリを1つの統合要約にまとめてください。
重要なポイントを漏らさず、簡潔にまとめてください。

カテゴリ: ${category}

エントリ一覧:
${entrySummaries}

以下の形式で回答してください:
タイトル: [統合タイトル]
内容: [統合された内容]`,
            },
          ],
          maxTokens: 1024,
        });

        const responseText = response.content;
        const titleMatch = responseText.match(/タイトル:\s*(.+)/);
        const contentMatch = responseText.match(/内容:\s*([\s\S]+)/);

        const title = titleMatch?.[1]?.trim() ?? `Consolidated: ${category}`;
        const content = contentMatch?.[1]?.trim() ?? responseText;

        // Create the consolidated entry
        const consolidated = await prisma.knowledgeEntry.create({
          data: {
            sourceType: 'consolidated',
            sourceId: `consolidation_run_${run.id}`,
            title,
            content,
            contentHash: createContentHash(content),
            category,
            tags: JSON.stringify([
              'consolidated',
              ...new Set(groupEntries.flatMap((e) => JSON.parse(e.tags))),
            ]),
            confidence:
              groupEntries.reduce((sum, e) => sum + e.confidence, 0) / groupEntries.length,
            themeId: themeId,
            validationStatus: 'validated',
            validatedAt: new Date(),
            validationMethod: 'consolidation',
          },
        });

        totalCreated++;
        totalMerged += groupEntries.length;

        log.info(
          {
            runId: run.id,
            category,
            themeId,
            merged: groupEntries.length,
            newEntryId: consolidated.id,
          },
          'Group consolidated',
        );
      } catch (error) {
        log.error({ err: error, key, count: groupEntries.length }, 'Failed to consolidate group');
      }
    }

    // Update the run record
    const durationMs = Date.now() - run.createdAt.getTime();
    await prisma.consolidationRun.update({
      where: { id: run.id },
      data: {
        status: 'completed',
        entriesProcessed: totalProcessed,
        entriesMerged: totalMerged,
        entriesCreated: totalCreated,
        durationMs,
      },
    });

    await appendEvent({
      eventType: 'consolidation_completed',
      payload: {
        runId: run.id,
        processed: totalProcessed,
        merged: totalMerged,
        created: totalCreated,
      },
    });

    log.info(
      {
        runId: run.id,
        processed: totalProcessed,
        merged: totalMerged,
        created: totalCreated,
        durationMs,
      },
      'Consolidation run completed',
    );

    return { runId: run.id, processed: totalProcessed, merged: totalMerged, created: totalCreated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.consolidationRun.update({
      where: { id: run.id },
      data: { status: 'failed', errorMessage: message },
    });
    log.error({ err: error, runId: run.id }, 'Consolidation run failed');
    throw error;
  }
}

/**
 * Retrieve consolidation run history.
 */
export async function getConsolidationRuns(limit = 20) {
  return prisma.consolidationRun.findMany({
    orderBy: { runDate: 'desc' },
    take: limit,
  });
}
