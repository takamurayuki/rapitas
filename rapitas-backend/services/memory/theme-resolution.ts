/**
 * theme-resolution
 *
 * Shared "always attribute a real theme" resolver for the memory ledgers
 * (idea box, concern backlog, hypothesis ledger). Extracted from
 * idea-box-service.ts so submitConcern can reuse the same hardened logic
 * instead of leaving themeId null whenever a caller omits it — the concern
 * backlog had no equivalent of this until concerns were found sitting
 * theme-less in the backlog (and thus invisible to per-theme backlog
 * auto-promotion, which filters on an exact themeId match).
 * Not responsible for task/idea/concern CRUD — read-only theme lookups only.
 */
import { prisma } from '../../config/database';

/**
 * Resolve the most appropriate theme for an item filed against a task, so it
 * doesn't fall into the "global" bucket just because the task itself has no
 * theme. Order: the task's own theme → a theme whose working directory
 * matches the task's → the default theme. Returns null only when none can be
 * found.
 *
 * NOTE: this is a different, hardened resolver from task-resolver.ts's
 * `resolveTaskThemeId` (a bare `task.findUnique → themeId` lookup used by
 * workflow/scheduler internals that specifically want the task's OWN theme
 * with no fallback cascade) — don't conflate the two.
 *
 * @param taskId - Task the item came from / 発生元タスクID
 * @returns The best theme id, or null. / 最適なテーマID、無ければnull
 */
export async function resolveTaskThemeId(taskId: number): Promise<number | null> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { themeId: true, workingDirectory: true },
    });
    if (task?.themeId != null) return task.themeId;
    if (task?.workingDirectory) {
      const byDir = await prisma.theme.findFirst({
        where: { workingDirectory: task.workingDirectory },
        select: { id: true },
      });
      if (byDir) return byDir.id;
    }
    // Fall back to a theme that actually has a working directory — these
    // items become tasks that run in a repo, so a working-dir theme is the
    // meaningful home (and a null/empty workingDirectory would otherwise show
    // as a generic project/global icon). Prefer a default working-dir theme,
    // then any. Only when no working-dir theme exists at all do we fall back
    // to a default / null.
    return await resolveDefaultThemeId();
  } catch {
    return null;
  }
}

/**
 * Resolve the home theme to use when an item has no task/theme of its own.
 * Prefers a default theme with a working directory, then any theme with one,
 * then the default theme, then ANY theme — so the item is tied to a real
 * theme (and shows that theme's icon) instead of falling into the global
 * bucket. Returns null only when no theme exists at all.
 *
 * @returns A theme id to attribute the item to, or null if there are no themes.
 */
export async function resolveDefaultThemeId(): Promise<number | null> {
  const candidates = await prisma.theme
    .findMany({
      select: { id: true, isDefault: true, workingDirectory: true },
      orderBy: { id: 'asc' },
    })
    .catch(() => [] as { id: number; isDefault: boolean; workingDirectory: string | null }[]);
  const hasWd = (wd: string | null): boolean => !!wd && wd.trim() !== '';
  const defaultWithWd = candidates.find((t) => t.isDefault && hasWd(t.workingDirectory));
  if (defaultWithWd) return defaultWithWd.id;
  const anyWithWd = candidates.find((t) => hasWd(t.workingDirectory));
  if (anyWithWd) return anyWithWd.id;
  // Last resort: the default theme, else ANY theme — never null while a theme exists.
  return candidates.find((t) => t.isDefault)?.id ?? candidates[0]?.id ?? null;
}
