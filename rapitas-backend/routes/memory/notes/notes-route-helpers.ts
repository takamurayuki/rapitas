/**
 * NotesRouteHelpers
 *
 * Request parsing and error mapping shared by the stage-1 note routes: the
 * `GET /notes` query string, the `placement` body field, and turning the
 * services' typed refusals into status codes. Not a route file itself.
 */
import { t } from 'elysia';
import type { NoteQuery, PlacementFilter } from '../../../services/notes/read/note-query';
import { NoteQueryError } from '../../../services/notes/read/note-query';
import { NotePlacementError } from '../../../services/notes/placement/placement-write';

/** `placement: { kind, id? }` on PUT / PATCH (design §2.2 API table). */
export const placementBody = t.Object({
  kind: t.Union([
    t.Literal('theme'),
    t.Literal('category'),
    t.Literal('folder'),
    t.Literal('none'),
  ]),
  id: t.Optional(t.Number()),
});

/** `source` a client may send: only manual / chat (contract 8). */
export const clientSourceBody = t.Union([t.Literal('manual'), t.Literal('chat')]);

/** The raw query string of `GET /notes`. */
export const listQuery = t.Object({
  taskId: t.Optional(t.String()),
  themeId: t.Optional(t.String()),
  categoryId: t.Optional(t.String()),
  folderId: t.Optional(t.String()),
  q: t.Optional(t.String({ maxLength: 200 })),
  source: t.Optional(t.String({ maxLength: 200 })),
  limit: t.Optional(t.String()),
  cursor: t.Optional(t.String({ maxLength: 500 })),
  fields: t.Optional(t.String()),
});

export type ListQueryString = {
  taskId?: string;
  themeId?: string;
  categoryId?: string;
  folderId?: string;
  q?: string;
  source?: string;
  limit?: string;
  cursor?: string;
  fields?: string;
};

/** The parameters stage 1 added; their absence keeps the stage-0 list. */
const STAGE1_KEYS = [
  'themeId',
  'categoryId',
  'folderId',
  'q',
  'source',
  'limit',
  'cursor',
  'fields',
] as const;

/**
 * Whether the query uses any stage-1 parameter.
 *
 * @param query - The raw query / 生のクエリ
 * @returns true when the stage-1 list applies / 第1段階の一覧を使うなら true
 */
export function usesStage1Query(query: ListQueryString): boolean {
  return STAGE1_KEYS.some((k) => query[k] !== undefined && query[k] !== '');
}

const positiveInt = (raw: string | undefined): number | undefined => {
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
};

/** `none` or a positive id; anything else is a 400. */
function placementFilter(raw: string | undefined): PlacementFilter | undefined | 'invalid' {
  if (raw === undefined || raw === '') return undefined;
  if (raw === 'none') return 'none';
  return positiveInt(raw) ?? 'invalid';
}

/**
 * Parse the query string. Returns the error code instead for a malformed one.
 *
 * @param query - The raw query / 生のクエリ
 * @returns The parsed query, or `{ error }` / 解析結果またはエラー
 */
export function parseListQuery(query: ListQueryString): NoteQuery | { error: string } {
  const out: NoteQuery = {};
  for (const key of ['themeId', 'categoryId', 'folderId'] as const) {
    const value = placementFilter(query[key]);
    if (value === 'invalid') return { error: `invalid_${key}` };
    if (value !== undefined) out[key] = value;
  }
  const taskId = positiveInt(query.taskId);
  if (taskId !== undefined) out.taskId = taskId;
  if (query.q) out.q = query.q;
  if (query.source)
    out.sources = query.source
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  if (query.limit !== undefined) {
    const limit = positiveInt(query.limit);
    if (limit === undefined) return { error: 'invalid_limit' };
    out.limit = limit;
  }
  if (query.cursor) out.cursor = query.cursor;
  if (query.fields !== undefined && query.fields !== 'summary') return { error: 'invalid_fields' };
  if (query.fields === 'summary') out.summary = true;
  return out;
}

/** The status setter Elysia hands a handler. */
export type StatusSetter = { status?: number | string };

/**
 * Map a stage-1 refusal to its status and body; rethrow anything else.
 *
 * @param error - What the service threw / 発生したエラー
 * @param set - Elysia's response setter / レスポンス設定
 * @returns The response body / レスポンス本文
 */
export function stage1Refusal(error: unknown, set: StatusSetter) {
  if (error instanceof NotePlacementError || error instanceof NoteQueryError) {
    set.status = error.status;
    return { success: false, error: error.code };
  }
  throw error;
}
