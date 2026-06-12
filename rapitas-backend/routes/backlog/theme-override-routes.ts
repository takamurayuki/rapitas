/**
 * backlog theme-override routes
 *
 * HTTP API for per-theme (per-project) overrides of backlog jobs: list themes
 * with their overrides, and upsert one override. Thin layer — delegates to
 * theme-backlog-override-service.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { normalizeJobKind } from '../../services/scheduling/backlog-schedule-service';
import {
  listThemeOverrides,
  upsertThemeOverride,
} from '../../services/scheduling/theme-backlog-override-service';

const log = createLogger('routes:backlog-theme-override');

export const backlogThemeOverrideRoutes = new Elysia({ prefix: '/backlog' })
  /**
   * Themes + their per-job overrides (for the per-project settings UI). Only
   * themes with a working directory are returned — without one there is nothing
   * to periodically scan, so they are neither shown nor run.
   */
  .get('/theme-overrides', async () => {
    const [themes, overrides] = await Promise.all([
      prisma.theme.findMany({
        where: { workingDirectory: { not: null } },
        select: { id: true, name: true, workingDirectory: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      listThemeOverrides(),
    ]);
    return { themes, overrides };
  })

  /** Upsert one theme's override for a job kind. */
  .patch(
    '/theme-overrides/:kind/:themeId',
    async ({ params, body, set }) => {
      const kind = normalizeJobKind(params.kind);
      if (!kind) {
        set.status = 400;
        return { error: `不明なジョブ種別です: ${params.kind}` };
      }
      const themeId = parseInt(params.themeId);
      if (isNaN(themeId)) {
        set.status = 400;
        return { error: '不正なテーマIDです' };
      }
      try {
        const override = await upsertThemeOverride(kind, themeId, body);
        return { success: true, override };
      } catch (err) {
        log.error({ err, kind, themeId }, 'Failed to upsert theme override');
        set.status = 500;
        return { error: 'プロジェクト別設定の保存に失敗しました' };
      }
    },
    {
      params: t.Object({ kind: t.String(), themeId: t.String() }),
      body: t.Object({
        enabled: t.Optional(t.Boolean()),
        logDir: t.Optional(t.Union([t.String(), t.Null()])),
        logFormat: t.Optional(t.String()),
      }),
    },
  );
