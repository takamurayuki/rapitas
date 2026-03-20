/**
 * TaskFrequencySuggestions
 *
 * Suggests tasks based on repetition frequency in a theme's completed task history.
 * Does NOT use AI or interact with external APIs.
 */
import { PrismaClient } from '@prisma/client';

type PrismaInstance = InstanceType<typeof PrismaClient>;

/**
 * Returns deduplicated suggestions ranked by how often a task title appeared in completed tasks.
 * Excludes titles that already have an active (todo / in-progress) task.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param themeId - Theme to query / クエリ対象のテーマ
 * @param limit - Maximum number of suggestions to return / 返す提案の最大件数
 * @returns Array of suggestion objects sorted by frequency then recency / 頻度・新しさ順のサジェスト配列
 */
export async function getFrequencyBasedSuggestions(
  prisma: PrismaInstance,
  themeId: number,
  limit: number,
) {
  const completedTasks = await prisma.task.findMany({
    where: { themeId, parentId: null, status: 'done' },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      estimatedHours: true,
      completedAt: true,
      taskLabels: { include: { label: true } },
    },
    orderBy: { completedAt: 'desc' },
    take: 50,
  });

  const existingTasks = await prisma.task.findMany({
    where: { themeId, parentId: null, status: { in: ['todo', 'in-progress'] } },
    select: { title: true },
  });

  const existingTitles = new Set(
    existingTasks.map((t: { title: string }) => t.title.toLowerCase().trim()),
  );

  const titleFrequency = new Map<
    string,
    {
      title: string;
      count: number;
      lastPriority: string;
      lastEstimatedHours: number | null;
      lastDescription: string | null;
      lastCompletedAt: Date | null;
      labelIds: number[];
    }
  >();

  for (const task of completedTasks) {
    const normalized = task.title.toLowerCase().trim();
    if (existingTitles.has(normalized)) continue;

    const existing = titleFrequency.get(normalized);
    if (existing) {
      existing.count++;
    } else {
      titleFrequency.set(normalized, {
        title: task.title,
        count: 1,
        lastPriority: task.priority,
        lastEstimatedHours: task.estimatedHours,
        lastDescription: task.description,
        lastCompletedAt: task.completedAt,
        labelIds: task.taskLabels?.map((tl: { labelId: number }) => tl.labelId) ?? [],
      });
    }
  }

  return Array.from(titleFrequency.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const aTime = a.lastCompletedAt?.getTime() ?? 0;
      const bTime = b.lastCompletedAt?.getTime() ?? 0;
      return bTime - aTime;
    })
    .slice(0, limit)
    .map((item) => ({
      title: item.title,
      frequency: item.count,
      priority: item.lastPriority,
      estimatedHours: item.lastEstimatedHours,
      description: item.lastDescription,
      labelIds: item.labelIds,
    }));
}
