/**
 * Notes Batch Routes
 *
 * `POST /notes/batch` (design §8.2 L4, §8.3): learning notes, materials and
 * the roadmap's closing note in one call after a roadmap commit. The server
 * decides each note's placement from its linked tasks; each element's note
 * and links are one transaction, and elements succeed or fail independently.
 *
 * Not responsible for generating the bodies — the flow sends them.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import {
  BATCH_SOURCES,
  MAX_BATCH_ITEMS,
  createNotesBatch,
} from '../../../services/notes/batch/note-batch';
import {
  MAX_NOTE_CONTENT,
  MAX_NOTE_TAGS,
  MAX_NOTE_TITLE,
} from '../../../services/notes/note-limits';

const noteId = t.String({ minLength: 1, maxLength: 64 });

const batchItem = t.Object({
  id: noteId,
  title: t.Optional(t.String({ maxLength: MAX_NOTE_TITLE })),
  content: t.Optional(t.String({ maxLength: MAX_NOTE_CONTENT })),
  tags: t.Optional(t.Array(t.String({ maxLength: 60 }), { maxItems: MAX_NOTE_TAGS })),
  docType: t.Optional(t.Union([t.String({ maxLength: 40 }), t.Null()])),
  source: t.Union(BATCH_SOURCES.map((s) => t.Literal(s))),
  taskIds: t.Array(t.Number(), { minItems: 1, maxItems: 100 }),
});

export const notesBatchRoutes = new Elysia({ prefix: '/notes' }).post(
  '/batch',
  async ({ body }) => {
    const results = await createNotesBatch(prisma, body.notes);
    return { success: true, results };
  },
  { body: t.Object({ notes: t.Array(batchItem, { minItems: 1, maxItems: MAX_BATCH_ITEMS }) }) },
);

export default notesBatchRoutes;
