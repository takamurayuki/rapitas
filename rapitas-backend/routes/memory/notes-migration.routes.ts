/**
 * Notes Migration Routes
 *
 * The two endpoints only the desktop's one-time move of its browser notes
 * uses (design §5.3): the body-free manifest it diffs against, and the
 * conditional write for the notes where the user chose the browser's version.
 *
 * Kept apart from notes.routes.ts because they are not part of the normal
 * note API: `migration/resolve` is the one place besides `/notes/import`
 * that accepts the old editor's HTML, and nothing else should call it.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import {
  buildMigrationManifest,
  resolveMigrationItems,
  VersionsPendingError,
} from '../../services/notes/note-migration';
import { MAX_NOTE_CONTENT, MAX_NOTE_TAGS, MAX_NOTE_TITLE } from '../../services/notes/note-limits';

/** Per request; each item may carry a body of up to MAX_NOTE_CONTENT. */
const MAX_RESOLVE_ITEMS = 50;

const resolveItem = t.Object({
  id: t.String({ minLength: 1, maxLength: 64 }),
  ifVersion: t.String({ minLength: 64, maxLength: 64 }),
  title: t.String({ maxLength: MAX_NOTE_TITLE }),
  content: t.String({ maxLength: MAX_NOTE_CONTENT }),
  tags: t.Array(t.String({ maxLength: 60 }), { maxItems: MAX_NOTE_TAGS }),
  docType: t.Union([t.String({ maxLength: 40 }), t.Null()]),
});

export const notesMigrationRoutes = new Elysia({ prefix: '/notes/migration' })
  .get('/manifest', async ({ set }) => {
    try {
      const notes = await buildMigrationManifest(prisma);
      return { success: true, notes };
    } catch (error) {
      if (error instanceof VersionsPendingError) {
        set.status = 503;
        return { success: false, error: 'versions_pending', pending: error.pending };
      }
      throw error;
    }
  })

  .post(
    '/resolve',
    async ({ body }) => {
      const results = await resolveMigrationItems(prisma, body.items);
      return { success: true, results };
    },
    { body: t.Object({ items: t.Array(resolveItem, { maxItems: MAX_RESOLVE_ITEMS }) }) },
  );

export default notesMigrationRoutes;
