/**
 * Idea Extractor
 *
 * Extracts [IDEA] markers from agent output and submits to IdeaBox.
 */
import { createLogger } from '../../../config/logger';
import { prisma as defaultPrisma } from '../../../config/database';

const logger = createLogger('idea-extractor');

// Deduplicate [IDEA] submissions within a single execution to avoid double-posting
// when the same output chunk is processed multiple times.
const recentIdeaHashes = new Set<string>();

// Cache resolved themeId per taskId for the lifetime of an execution to avoid
// hitting the DB on every streamed chunk.
const taskThemeIdCache = new Map<number, number | null>();

async function resolveThemeIdForTask(taskId: number): Promise<number | null> {
  if (taskThemeIdCache.has(taskId)) return taskThemeIdCache.get(taskId) ?? null;
  try {
    const task = await defaultPrisma.task.findUnique({
      where: { id: taskId },
      select: { themeId: true },
    });
    const themeId = task?.themeId ?? null;
    taskThemeIdCache.set(taskId, themeId);
    // Bound the cache to prevent leaks across many executions.
    if (taskThemeIdCache.size > 500) {
      const firstKey = taskThemeIdCache.keys().next().value;
      if (firstKey !== undefined) taskThemeIdCache.delete(firstKey);
    }
    return themeId;
  } catch {
    return null;
  }
}

/**
 * Parse [IDEA] markers from agent output and submit each to the IdeaBox.
 * Called inline during log streaming — must not block or throw.
 */
export function extractIdeaMarkers(output: string, taskId: number): void {
  const lines = output.split('\n');
  for (const line of lines) {
    const match = line.match(/\[IDEA]\s*(.+)/);
    if (!match) continue;

    const content = match[1].trim();
    if (!content || content.length < 5) continue;

    // Simple dedup within this process lifetime
    const hash = `${taskId}:${content.slice(0, 50)}`;
    if (recentIdeaHashes.has(hash)) continue;
    recentIdeaHashes.add(hash);
    // NOTE: Keep the set bounded to prevent memory leak in long-running processes.
    if (recentIdeaHashes.size > 200) {
      const first = recentIdeaHashes.values().next().value;
      if (first) recentIdeaHashes.delete(first);
    }

    resolveThemeIdForTask(taskId)
      .then((themeId) =>
        import('../../memory/idea-box-service').then(({ submitIdea }) =>
          submitIdea({
            title: content.slice(0, 80),
            content,
            taskId,
            themeId: themeId ?? undefined,
            scope: themeId ? 'project' : 'global',
            source: 'agent_execution',
            confidence: 0.8,
          }),
        ),
      )
      .then(() => {
        logger.debug({ taskId, idea: content.slice(0, 60) }, '[IDEA] marker submitted');
      })
      .catch(() => {});
  }
}
