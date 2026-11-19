/**
 * Notes Stage-1 Routes
 *
 * The placement endpoints of notes stage 1 (design §2.2 API table, §8.3):
 *
 * - `GET /notes/tree` — the tree skeleton with counts, no bodies.
 * - `POST /notes/:id/placement/reset` — 「タスクの分類に戻す」 for a deliverable.
 * - `GET /notes/theme-delete-preview/:themeId` — where a theme's notes would go
 *   if it were deleted, from the same function the delete uses.
 *
 * Not responsible for the stage-0 note CRUD — see ../notes.routes.ts.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { buildNoteTree } from '../../../services/notes/read/note-tree';
import { resetPlacementToTask } from '../../../services/notes/placement/note-follow';
import { planThemeDelete } from '../../../services/notes/placement/theme-delete';
import { requestWorkspaceId } from '../../../services/notes/note-scope';
import { isValidEntityId } from '../../../utils/common/id-validation';

const noteId = t.String({ minLength: 1, maxLength: 64 });

export const notesStage1Routes = new Elysia({ prefix: '/notes' })
  .get('/tree', async () => ({ success: true, tree: await buildNoteTree(prisma) }))

  .post(
    '/:id/placement/reset',
    async ({ params, set }) => {
      const outcome = await resetPlacementToTask(prisma, params.id);
      if (!outcome.ok) {
        set.status = outcome.status;
        return { success: false, error: outcome.error };
      }
      return { success: true, placement: outcome.placement };
    },
    { params: t.Object({ id: noteId }) },
  )

  .get(
    '/theme-delete-preview/:themeId',
    async ({ params, set }) => {
      if (!isValidEntityId(params.themeId)) {
        set.status = 400;
        return { success: false, error: 'invalid_theme_id' };
      }
      // The same workspace check as the delete itself: another workspace's theme is a 404.
      const plan = await planThemeDelete(prisma, Number(params.themeId), requestWorkspaceId());
      if (!plan) {
        set.status = 404;
        return { success: false, error: 'theme_not_found' };
      }
      const { toCategory, toUnclassified, toThemes, theme } = plan;
      return { success: true, categoryId: theme.categoryId, toCategory, toUnclassified, toThemes };
    },
    { params: t.Object({ themeId: t.String() }) },
  );

export default notesStage1Routes;
