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
 * `POST /notes/draft-from-reply` writes nothing: it turns ラピ's reply into a
 * titled, tidied draft that the client then saves with `PUT /notes/:id`.
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
  unlinkNote,
  importNotes,
  NoteWriteConflictError,
  NoteContentRejectedError,
  queryNotes,
  MAX_NOTE_TITLE,
  MAX_NOTE_CONTENT,
  MAX_NOTE_TAGS,
  type NoteInput,
} from '../../services/notes/note-service';
import { draftNoteFromReply } from '../../services/notes/note-draft';
import { importNoteLinks, linkNoteInScope } from '../../services/notes/note-links';
import { isValidEntityId } from '../../utils/common/id-validation';
import {
  clientSourceBody,
  listQuery,
  parseListQuery,
  placementBody,
  stage1Refusal,
  usesStage1Query,
} from './notes/notes-route-helpers';

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
  // Stage 1: a move, and manual / chat only. sourceTaskId / followsTask /
  // sourceRef are server-only and not accepted (contract 8).
  placement: t.Optional(placementBody),
  source: t.Optional(clientSourceBody),
});

/** ラピ's reply to turn into a note draft; the question is not sent. */
const draftBody = t.Object({ answer: t.String({ maxLength: MAX_NOTE_CONTENT }) });

// NOTE: taskTitle / categoryName were added in stage 0 — the desktop's tree
// is built from category > theme > task, the phone shows project / theme /
// parent task, and both now write and read the one shape.
const linkMeta = t.Object({
  taskTitle: t.Optional(t.String({ maxLength: 300 })),
  categoryName: t.Optional(t.String({ maxLength: 200 })),
  themeName: t.Optional(t.String({ maxLength: 200 })),
  projectName: t.Optional(t.String({ maxLength: 200 })),
  parentTaskTitle: t.Optional(t.String({ maxLength: 300 })),
});

const linkBody = t.Object({
  taskId: t.Number(),
  meta: t.Optional(linkMeta),
});

/** The migration's link import: bounded like `/notes/import`. */
const linkImportBody = t.Object({
  links: t.Array(t.Object({ noteId, taskId: t.Number(), meta: t.Optional(linkMeta) }), {
    maxItems: 500,
  }),
});

/** The status setter Elysia hands a handler. */
type StatusSetter = { status?: number | string };

/**
 * Save through the version contract and map its refusal to a status.
 *
 * @param id - The note id from the URL / URL のノートID
 * @param body - The sent fields / 送られた項目
 * @param set - Elysia's response setter / レスポンス設定
 * @returns The response body / レスポンス本文
 */
async function writeNote(id: string, body: NoteInput, set: StatusSetter) {
  try {
    const note = await saveNote(prisma, id, body);
    return { success: true, note };
  } catch (error) {
    if (error instanceof NoteContentRejectedError) {
      // Legacy rich-editor HTML: new bodies are Markdown only. The client
      // converts an HTML note (and shows the result) before saving it here.
      set.status = 400;
      return { success: false, error: 'legacy_html_content' };
    }
    if (error instanceof NoteWriteConflictError) {
      set.status = 409;
      return { success: false, error: 'note_write_conflict' };
    }
    return stage1Refusal(error, set);
  }
}

export const notesRoutes = new Elysia({ prefix: '/notes' })
  .get(
    '/',
    async ({ query, set }) => {
      // Stage 1: filters, search, paging and summaries. Without any of them
      // the list is the stage-0 one (all notes, bodies included).
      if (usesStage1Query(query)) {
        const parsed = parseListQuery(query);
        if ('error' in parsed) {
          set.status = 400;
          return { success: false, error: parsed.error };
        }
        try {
          return { success: true, ...(await queryNotes(prisma, parsed)) };
        } catch (error) {
          return stage1Refusal(error, set);
        }
      }
      const taskId = query.taskId ? Number(query.taskId) : undefined;
      const notes = await listNotes(
        prisma,
        taskId !== undefined && Number.isFinite(taskId) ? taskId : undefined,
      );
      return { success: true, notes };
    },
    { query: listQuery },
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

  .put('/:id', async ({ params, body, set }) => writeNote(params.id, body, set), {
    params: t.Object({ id: noteId }),
    body: noteBody,
  })

  // PATCH and PUT do the same thing here on purpose: the write is an upsert
  // of exactly the fields that were sent, so there is no "replace the whole
  // note" variant to distinguish. Both are offered because callers reach for
  // either, and a 405 would be a pointless thing to debug.
  .patch('/:id', async ({ params, body, set }) => writeNote(params.id, body, set), {
    params: t.Object({ id: noteId }),
    body: noteBody,
  })

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
      // a caller mistake worth naming, not a 500. The task is looked up in the
      // request's workspace too (design §2.2) — another workspace's task is
      // the same 404 as one that does not exist.
      const refused = await linkNoteInScope(prisma, params.id, body.taskId, body.meta);
      if (refused) {
        set.status = 404;
        return { success: false, error: refused };
      }
      return { success: true };
    },
    { params: t.Object({ id: noteId }), body: linkBody },
  )

  .delete(
    '/:id/links/:taskId',
    async ({ params, set }) => {
      if (!isValidEntityId(params.taskId)) {
        set.status = 400;
        return { success: false, error: 'invalid_task_id' };
      }
      const taskId = Number(params.taskId);
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
    '/draft-from-reply',
    async ({ body, set }) => {
      if (!body.answer.trim()) {
        set.status = 400;
        return { success: false, error: 'empty_answer' };
      }
      // NOTE: no unformatted fallback — the feature exists to save a tidied
      // document, so a failed draft is an error and the client saves nothing.
      try {
        const draft = await draftNoteFromReply(body.answer);
        return { success: true, ...draft };
      } catch {
        set.status = 502;
        return { success: false, error: 'draft_failed' };
      }
    },
    { body: draftBody },
  )

  // The desktop migration's link import: adds links the server lacks and
  // fills only empty meta keys on the ones it has — the plain link endpoint
  // replaces meta, which would undo what the phone wrote. Per-link results,
  // with another workspace's task refused as a 404 for that link.
  .post(
    '/links/import',
    async ({ body }) => {
      const results = await importNoteLinks(prisma, body.links);
      return { success: true, results };
    },
    { body: linkImportBody },
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
