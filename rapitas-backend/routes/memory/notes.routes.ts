/**
 * Notes Routes
 *
 * Notes over HTTP, for the first time.
 *
 * They lived in one browser's localStorage, which meant nothing but a
 * mounted React component could read or write one — ラピ could leave a note
 * while her panel was open and not otherwise. These are the endpoints that
 * change that; the store is pointed at them separately.
 *
 * `PUT /notes/:id` rather than `POST /notes`: the id belongs to the caller,
 * because every note already in a browser has one and task descriptions
 * across the backlog carry `/rapitas-note/{taskId}/{noteId}` chips pointing
 * at it. An id minted here would break all of them.
 *
 * Not responsible for the one-time import's bookkeeping — it is a plain
 * endpoint that skips what exists, and the client decides when to call it.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import {
  listNotes,
  getNote,
  saveNote,
  deleteNote,
  linkNote,
  unlinkNote,
  importNotes,
  MAX_NOTE_TITLE,
  MAX_NOTE_CONTENT,
  MAX_NOTE_TAGS,
} from '../../services/notes/note-service';

/** An id a browser minted, or a cuid. Bounded so it cannot be a document. */
const noteId = t.String({ minLength: 1, maxLength: 64 });

/** The writable fields, as a plain shape so it can be reused with an id. */
const writable = {
  title: t.Optional(t.String({ maxLength: MAX_NOTE_TITLE })),
  content: t.Optional(t.String({ maxLength: MAX_NOTE_CONTENT })),
  isPinned: t.Optional(t.Boolean()),
  tags: t.Optional(t.Array(t.String({ maxLength: 60 }), { maxItems: MAX_NOTE_TAGS })),
  color: t.Optional(t.Union([t.String({ maxLength: 40 }), t.Null()])),
  docType: t.Optional(t.Union([t.String({ maxLength: 40 }), t.Null()])),
} as const;

/** The writable half of a note. Every field optional — a PATCH is partial. */
const noteBody = t.Object({
  title: t.Optional(t.String({ maxLength: MAX_NOTE_TITLE })),
  content: t.Optional(t.String({ maxLength: MAX_NOTE_CONTENT })),
  isPinned: t.Optional(t.Boolean()),
  tags: t.Optional(t.Array(t.String({ maxLength: 60 }), { maxItems: MAX_NOTE_TAGS })),
  color: t.Optional(t.Union([t.String({ maxLength: 40 }), t.Null()])),
  docType: t.Optional(t.Union([t.String({ maxLength: 40 }), t.Null()])),
});

/** Context captured when a note is linked from a task. */
const linkBody = t.Object({
  taskId: t.Number(),
  meta: t.Optional(
    t.Object({
      themeName: t.Optional(t.String({ maxLength: 200 })),
      projectName: t.Optional(t.String({ maxLength: 200 })),
      parentTaskTitle: t.Optional(t.String({ maxLength: 300 })),
    }),
  ),
});

export const notesRoutes = new Elysia({ prefix: '/notes' })
  .get(
    '/',
    async ({ query }) => {
      const taskId = query.taskId ? Number(query.taskId) : undefined;
      const notes = await listNotes(
        prisma,
        taskId !== undefined && Number.isFinite(taskId) ? taskId : undefined,
      );
      return { success: true, notes };
    },
    { query: t.Object({ taskId: t.Optional(t.String()) }) },
  )

  .get(
    '/:id',
    async ({ params, set }) => {
      const note = await getNote(prisma, params.id);
      if (!note) {
        set.status = 404;
        return { success: false, error: 'note_not_found' };
      }
      return { success: true, note };
    },
    { params: t.Object({ id: noteId }) },
  )

  .put(
    '/:id',
    async ({ params, body }) => {
      const note = await saveNote(prisma, params.id, body);
      return { success: true, note };
    },
    { params: t.Object({ id: noteId }), body: noteBody },
  )

  // PATCH and PUT do the same thing here on purpose: the write is an upsert
  // of exactly the fields that were sent, so there is no "replace the whole
  // note" variant to distinguish. Both are offered because callers reach for
  // either, and a 405 would be a pointless thing to debug.
  .patch(
    '/:id',
    async ({ params, body }) => {
      const note = await saveNote(prisma, params.id, body);
      return { success: true, note };
    },
    { params: t.Object({ id: noteId }), body: noteBody },
  )

  .delete(
    '/:id',
    async ({ params, set }) => {
      const removed = await deleteNote(prisma, params.id);
      if (!removed) {
        set.status = 404;
        return { success: false, error: 'note_not_found' };
      }
      return { success: true };
    },
    { params: t.Object({ id: noteId }) },
  )

  .post(
    '/:id/links',
    async ({ params, body, set }) => {
      // Checked rather than left to the foreign key: a missing note here is
      // a caller mistake worth naming, not a 500.
      const note = await getNote(prisma, params.id);
      if (!note) {
        set.status = 404;
        return { success: false, error: 'note_not_found' };
      }
      await linkNote(prisma, params.id, body.taskId, body.meta);
      return { success: true };
    },
    { params: t.Object({ id: noteId }), body: linkBody },
  )

  .delete(
    '/:id/links/:taskId',
    async ({ params, set }) => {
      const taskId = Number(params.taskId);
      if (!Number.isFinite(taskId)) {
        set.status = 400;
        return { success: false, error: 'invalid_task_id' };
      }
      const removed = await unlinkNote(prisma, params.id, taskId);
      if (!removed) {
        set.status = 404;
        return { success: false, error: 'link_not_found' };
      }
      return { success: true };
    },
    { params: t.Object({ id: noteId, taskId: t.String() }) },
  )

  .post(
    '/import',
    async ({ body }) => {
      const result = await importNotes(prisma, body.notes);
      return { success: true, ...result };
    },
    {
      body: t.Object({
        // Bounded: this is one browser's notes, not a backlog import.
        // Spread rather than t.Intersect: intersecting an object of
        // optionals with a required id rejects a valid note outright
        // (measured — a two-note import came back 422).
        notes: t.Array(t.Object({ id: noteId, ...writable }), { maxItems: 500 }),
      }),
    },
  );

export default notesRoutes;
