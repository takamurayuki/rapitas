/**
 * LabelCategoryBackfill
 *
 * One-shot backfill for the theme→category label migration: a label still
 * scoped to a theme inherits that theme's category. Idempotent — only rows
 * still missing categoryId are read — and best-effort: a failure is logged and
 * retried on the next boot. Remove together with Label.themeId once every row
 * carries categoryId.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('label-category-backfill');

/**
 * Copy each theme-scoped label's theme category onto the label.
 *
 * NOTE: This used to run as an un-awaited IIFE at the top of
 * routes/organization/labels.ts, i.e. while the module graph was still being
 * imported. Its query started Prisma's engine before the desktop SQLite
 * initializer had closed its own bun:sqlite connection, which corrupted the
 * engine's view of the WAL (#1000). Now it runs from startup-backfills.
 *
 * @returns Labels updated / 更新したラベル数
 */
export async function backfillLabelCategories(): Promise<number> {
  try {
    const orphans = await prisma.label.findMany({
      where: { categoryId: null, themeId: { not: null } },
      select: { id: true, theme: { select: { categoryId: true } } },
    });
    let updated = 0;
    for (const label of orphans) {
      if (label.theme?.categoryId != null) {
        await prisma.label.update({
          where: { id: label.id },
          data: { categoryId: label.theme.categoryId },
        });
        updated++;
      }
    }
    return updated;
  } catch (err) {
    log.warn({ err }, 'Label category backfill failed; retried on next boot');
    return 0;
  }
}
