/**
 * Knowledge Consolidation
 *
 * Groups recent KnowledgeEntries by category + theme, splits each group into
 * token-bounded chunks, and uses LLM to summarize each chunk into a consolidated entry.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { sendAIMessage } from '../../utils/ai-client';
import { appendEvent } from './timeline';
import { createContentHash, parseTagsAsStrings } from './utils';
import { chunkEntries, estimateChunkTokens, formatEntryLine } from './consolidation-chunking';
import type { ChunkableEntry } from './consolidation-chunking';

const log = createLogger('memory:consolidation');

// 7 days, not 24h: entries deferred (chunk cap) or failed must stay eligible for retry,
// but not forever, or the nightly job would keep growing.
const CONSOLIDATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const SRC_TAG_PREFIX = 'src:';

// Consecutive failed chunks per group key. In-memory on purpose: it only feeds warn logs,
// so resetting on restart is acceptable.
const consecutiveFailures = new Map<string, number>();

/** Test hook: clear the in-memory consecutive failure counters. */
export function resetConsolidationFailureState(): void {
  consecutiveFailures.clear();
}

/**
 * Collect ids of entries already merged into a consolidated entry within the window.
 *
 * @param since - Window start / 窓の開始時刻
 * @returns Set of source entry ids recorded via `src:<id>` tags / 統合済みエントリid集合
 */
async function loadMergedSourceIds(since: Date): Promise<Set<number>> {
  const consolidated = await prisma.knowledgeEntry.findMany({
    where: { sourceType: 'consolidated', createdAt: { gte: since } },
    select: { tags: true },
  });
  const ids = new Set<number>();
  for (const row of consolidated) {
    for (const tag of parseTagsAsStrings(row.tags)) {
      if (!tag.startsWith(SRC_TAG_PREFIX)) continue;
      const id = Number(tag.slice(SRC_TAG_PREFIX.length));
      if (Number.isInteger(id)) ids.add(id);
    }
  }
  return ids;
}

interface ConsolidatableEntry extends ChunkableEntry {
  tags: string;
  confidence: number;
}

/**
 * Summarize one chunk via LLM and persist the consolidated entry.
 *
 * @param params - Run/chunk identity and the entries to merge / 実行・チャンク情報と対象エントリ
 * @returns The created consolidated entry / 作成された統合エントリ
 * @throws When the LLM call or the DB write fails / LLM呼び出しまたはDB書き込み失敗時
 */
async function consolidateChunk(params: {
  runId: number;
  chunkIndex: number;
  category: string;
  themeId: number | null;
  chunk: ConsolidatableEntry[];
}) {
  const { runId, chunkIndex, category, themeId, chunk } = params;
  const entrySummaries = chunk.map((e, i) => formatEntryLine(e, i)).join('\n\n');

  const response = await sendAIMessage({
    messages: [
      {
        role: 'user',
        content: `以下の${chunk.length}件の知識エントリを1つの統合要約にまとめてください。
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

  return prisma.knowledgeEntry.create({
    data: {
      sourceType: 'consolidated',
      sourceId: `consolidation_run_${runId}_c${chunkIndex}`,
      title,
      content,
      contentHash: createContentHash(content),
      category,
      tags: JSON.stringify([
        'consolidated',
        ...new Set(chunk.flatMap((e) => parseTagsAsStrings(e.tags))),
        ...chunk.map((e) => `${SRC_TAG_PREFIX}${e.id}`),
      ]),
      confidence: chunk.reduce((sum, e) => sum + e.confidence, 0) / chunk.length,
      themeId,
      validationStatus: 'validated',
      validatedAt: new Date(),
      validationMethod: 'consolidation',
    },
  });
}

/**
 * Run the consolidation process.
 *
 * Groups entries by category + themeId and summarizes groups with 3+ entries via LLM,
 * in chunks bounded by token estimate. A failed chunk is skipped, not fatal.
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
    const since = new Date(Date.now() - CONSOLIDATION_WINDOW_MS);
    const alreadyMerged = await loadMergedSourceIds(since);

    // Fetch active entries from the window. Excludes 'hypothesis' as
    // well as 'consolidated': the hypothesis ledger overloads this same
    // KnowledgeEntry.tags column to store `{evidence:[...]}` (see
    // hypothesis-service.ts's file header — a deliberate storage hack, no
    // schema change), not a string[] like every other sourceType. Mixing a
    // hypothesis entry into a consolidation group fed that object straight
    // into the flatMap below, corrupting the merged tags array with a raw
    // object element that later crashed the frontend
    // ("Objects are not valid as a React child... {evidence}").
    const fetched = await prisma.knowledgeEntry.findMany({
      where: {
        createdAt: { gte: since },
        forgettingStage: 'active',
        // NOTE: 'playbook' is excluded for semantic separation, not tags shape
        // (its tags stay a plain string[]): a procedure doc summarised together
        // with unrelated task_pattern entries loses exactly what makes it a
        // playbook — the concrete file list and step ordering.
        sourceType: { notIn: ['consolidated', 'hypothesis', 'playbook'] },
      },
      orderBy: { createdAt: 'asc' },
    });
    // NOTE: The window is 7 days but each entry must be merged once; `src:<id>` tags on
    // consolidated entries are the record of what was already merged (no schema change).
    const entries = fetched.filter((e) => !alreadyMerged.has(e.id));

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

      const [category, themeIdStr] = key.split(':');
      const themeId = themeIdStr === 'null' ? null : parseInt(themeIdStr, 10);
      const { chunks, deferred } = chunkEntries(groupEntries);

      if (deferred.length > 0) {
        log.info(
          { runId: run.id, key, deferred: deferred.length },
          'Group exceeds per-run chunk limit; remaining entries deferred to the next run',
        );
      }

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        totalProcessed += chunk.length;

        try {
          const consolidated = await consolidateChunk({
            runId: run.id,
            chunkIndex,
            category,
            themeId,
            chunk,
          });
          consecutiveFailures.delete(key);
          totalCreated++;
          totalMerged += chunk.length;

          log.info(
            {
              runId: run.id,
              category,
              themeId,
              chunkIndex,
              merged: chunk.length,
              newEntryId: consolidated.id,
            },
            'Group consolidated',
          );
        } catch (error) {
          const failures = (consecutiveFailures.get(key) ?? 0) + 1;
          consecutiveFailures.set(key, failures);
          log.warn(
            {
              err: error,
              groupKey: key,
              chunkIndex,
              entryIds: chunk.map((e) => e.id),
              count: chunk.length,
              chars: chunk.reduce((n, e) => n + e.title.length + e.content.length, 0),
              estimatedTokens: estimateChunkTokens(chunk),
              consecutiveFailures: failures,
            },
            'Failed to consolidate group chunk',
          );
        }
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
