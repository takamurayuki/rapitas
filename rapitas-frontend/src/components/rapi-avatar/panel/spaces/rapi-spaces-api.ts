/**
 * rapi-spaces-api
 *
 * The calls the web makes to ラピ's conversation spaces (`/rapi-chat/*`),
 * the store the mobile app already keeps its conversations in — so a
 * conversation started on one client is there on the other.
 *
 * Shapes follow `rapitas-backend/routes/ai/rapi-chat-spaces.routes.ts` and
 * the mobile client `rapitas-mobile/lib/services/rapi_chat_space_service.dart`.
 * Also turns saved rows into thread lines and back. Not responsible for
 * when to call — see `useRapiSpaces`.
 */
import { API_BASE_URL } from '@/utils/api';
import type { RapiMessage, RapiRole } from '../conversation';

/** One space in the switcher. */
export interface RapiSpaceSummary {
  id: number;
  /** Null until the first user line names it (shown as 「新しい会話」). */
  title: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
}

/** One saved row, as the server returns it. */
export interface SavedMessage {
  id: number;
  clientId: string;
  role: string;
  kind: string;
  text: string;
  taskId: number | null;
  inHistory: boolean;
  payload: string | null;
  clientCreatedAt: string | null;
}

/** The newest messages the panel loads when a space is opened. */
export const LOAD_LIMIT = 100;

const json = { 'Content-Type': 'application/json' };

/**
 * Every space, newest activity first.
 *
 * @returns The spaces / 会話スペースの一覧
 * @throws {Error} When the request fails / 取得に失敗したとき
 */
export async function fetchSpaces(): Promise<RapiSpaceSummary[]> {
  const res = await fetch(`${API_BASE_URL}/rapi-chat/spaces`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { spaces?: RapiSpaceSummary[] };
  return body.spaces ?? [];
}

/**
 * Create a space. `clientKey` makes a resend after a lost response return
 * the same space instead of a second one.
 *
 * @param clientKey - Key generated for this attempt / 再送判定用の鍵
 * @returns The space, or `'limit'` when no more may be made / 作成した会話か上限
 * @throws {Error} When the request fails otherwise / それ以外の失敗
 */
export async function createSpace(clientKey: string): Promise<RapiSpaceSummary | 'limit'> {
  const res = await fetch(`${API_BASE_URL}/rapi-chat/spaces`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ clientKey }),
  });
  if (res.status === 409) return 'limit';
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { space: RapiSpaceSummary };
  return body.space;
}

/**
 * The newest messages of a space, oldest first.
 *
 * @param spaceId - Space id / 会話スペースID
 * @returns The rows, or null when the space no longer exists / 行（無ければ null）
 * @throws {Error} When the request fails otherwise / それ以外の失敗
 */
export async function fetchMessages(spaceId: number): Promise<SavedMessage[] | null> {
  const res = await fetch(
    `${API_BASE_URL}/rapi-chat/spaces/${spaceId}/messages?limit=${LOAD_LIMIT}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { messages?: SavedMessage[] };
  return body.messages ?? [];
}

/**
 * Save lines to a space, keyed by `clientId` so a resend rewrites the rows.
 *
 * @param spaceId - Space id / 会話スペースID
 * @param lines - Lines to write / 保存する行
 * @returns The space's title after the write (the server names it) / 保存後のタイトル
 * @throws {Error} When the request fails / 保存に失敗したとき
 */
export async function putMessages(
  spaceId: number,
  lines: RapiMessage[],
): Promise<{ title: string | null }> {
  const res = await fetch(`${API_BASE_URL}/rapi-chat/spaces/${spaceId}/messages`, {
    method: 'PUT',
    headers: json,
    body: JSON.stringify({ messages: lines.map(toSaved) }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { space?: { title: string | null } };
  return { title: body.space?.title ?? null };
}

/**
 * A thread line as a row to save. Always `kind: 'text'`: the web's cards are
 * live components with nothing to snapshot, so what is kept for a routed
 * request is its note.
 *
 * @param line - The line / 会話の1件
 * @returns The row / 保存する行
 */
export function toSaved(line: RapiMessage) {
  return {
    clientId: line.clientId,
    role: line.role,
    kind: 'text',
    text: line.text,
    inHistory: line.inHistory,
    clientCreatedAt: new Date().toISOString(),
  };
}

const ROLES: readonly RapiRole[] = ['user', 'assistant', 'system'];

/**
 * A saved row as a thread line. A card the mobile app saved keeps its kind,
 * so the thread can say it is a record rather than drawing nothing.
 *
 * @param row - Saved row / 保存された行
 * @returns The line, without its in-session id / 会話の1件
 */
export function fromSaved(row: SavedMessage): Omit<RapiMessage, 'id'> {
  const role = (ROLES as readonly string[]).includes(row.role) ? (row.role as RapiRole) : 'system';
  return {
    clientId: row.clientId,
    role,
    text: row.text,
    inHistory: row.inHistory,
    ...(row.kind !== 'text' ? { archivedKind: row.kind } : {}),
  };
}
