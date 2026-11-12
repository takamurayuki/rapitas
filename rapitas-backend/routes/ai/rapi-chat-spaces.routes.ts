/**
 * Rapi Chat Spaces Routes
 *
 * CRUD for the conversation spaces of ラピ's chat (nav39 design §4): list,
 * create, delete, read a page of messages, save a batch of messages.
 *
 * Not under `/assistant`: these are plain record reads and writes, not ラピ's
 * capabilities, so they declare no capability and write no AssistantAction.
 * The assistant pipeline never reads a space — turns stay client-built.
 *
 * Bodies are validated by hand, not with `t.Object`: Elysia answers a schema
 * failure with 422, which this API reserves for "these items were refused"
 * (`invalid_items`); a malformed body as a whole is a 400 here.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../config/database';
import {
  createSpace,
  deleteSpace,
  listMessages,
  listSpaces,
  pageLimit,
  parseCreateBody,
  parsePutBody,
  putMessages,
  type RapiChatDb,
} from '../../services/rapi-chat';

let db = prisma as unknown as RapiChatDb;

/**
 * Test seam: point the routes at another client (a real SQLite in tests).
 *
 * @param client - Client to use / 使うクライアント
 */
export function setRapiChatDbForTest(client: RapiChatDb): void {
  db = client;
}

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export const rapiChatSpacesRoutes = new Elysia({ prefix: '/rapi-chat' })
  .get('/spaces', async () => ({ success: true, spaces: await listSpaces(db) }))

  .post('/spaces', async ({ body, set }) => {
    const input = parseCreateBody(body);
    if (!input) {
      set.status = 400;
      return { success: false, error: 'invalid_body' };
    }
    const result = await createSpace(db, input);
    if (result.kind === 'limit') {
      set.status = 409;
      return { success: false, error: 'space_limit' };
    }
    set.status = result.kind === 'created' ? 201 : 200;
    return { success: true, space: result.space };
  })

  .delete('/spaces/:id', async ({ params, set }) => {
    const id = parseId(params.id);
    const deleted = id === null ? null : await deleteSpace(db, id);
    if (deleted === null) {
      set.status = 404;
      return { success: false, error: 'not_found' };
    }
    return { success: true, deletedMessages: deleted };
  })

  .get('/spaces/:id/messages', async ({ params, query, set }) => {
    const id = parseId(params.id);
    const before = query.before === undefined ? null : parseId(String(query.before));
    if (query.before !== undefined && before === null) {
      set.status = 400;
      return { success: false, error: 'invalid_before' };
    }
    const page =
      id === null ? null : await listMessages(db, id, { before, limit: pageLimit(query.limit) });
    if (!page) {
      set.status = 404;
      return { success: false, error: 'not_found' };
    }
    return { success: true, ...page };
  })

  .put('/spaces/:id/messages', async ({ params, body, set }) => {
    const id = parseId(params.id);
    if (id === null) {
      set.status = 404;
      return { success: false, error: 'not_found' };
    }
    const parsed = parsePutBody(body);
    if (!parsed.ok) {
      set.status = 400;
      return { success: false, error: parsed.error };
    }
    const result = await putMessages(db, id, parsed.items);
    switch (result.kind) {
      case 'not_found':
        set.status = 404;
        return { success: false, error: 'not_found' };
      case 'invalid':
        set.status = 422;
        return { success: false, error: 'invalid_items', rejected: result.rejected };
      case 'limit':
        set.status = 409;
        return {
          success: false,
          error: 'message_limit',
          remaining: result.remaining,
          rejected: result.rejected,
        };
      case 'saved':
        return {
          success: true,
          saved: result.saved,
          removed: result.removed,
          space: result.space,
        };
    }
  });

export default rapiChatSpacesRoutes;
