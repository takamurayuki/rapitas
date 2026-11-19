/**
 * note-api
 *
 * The desktop's calls to the note API (`/notes`), and the conversion of the
 * server's note into the store's `Note`. Not responsible for state or for
 * the one-time migration endpoints — see `note-store.ts` and
 * `components/note/migration/note-migration-api.ts`.
 */
import { API_BASE_URL } from '@/utils/api';
import type { DocType, Note, NoteTaskMeta, NoteUpdate } from './note-types';

/** A note as `GET /notes` returns it (dates as ISO strings). */
export interface ServerNote {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  tags: string[];
  color?: string;
  docType?: string;
  createdAt: string;
  updatedAt: string;
  linkedTaskIds: number[];
  linkedTaskMeta: Record<string, NoteTaskMeta>;
}

/** A refused or failed note request, with the server's error code when it sent one. */
export class NoteApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`note request failed: HTTP ${status}${code ? ` (${code})` : ''}`);
    this.name = 'NoteApiError';
  }
}

/**
 * The store's shape for a server note.
 *
 * @param n - The server note / サーバーのノート
 * @returns The store note / ストアのノート
 */
export function fromServerNote(n: ServerNote): Note {
  const meta: Record<number, NoteTaskMeta> = {};
  for (const [taskId, value] of Object.entries(n.linkedTaskMeta ?? {}))
    meta[Number(taskId)] = value;
  return {
    id: n.id,
    title: n.title,
    content: n.content,
    isPinned: n.isPinned,
    tags: n.tags ?? [],
    ...(n.color ? { color: n.color } : {}),
    ...(n.docType ? { docType: n.docType as DocType } : {}),
    createdAt: new Date(n.createdAt),
    updatedAt: new Date(n.updatedAt),
    linkedTaskIds: n.linkedTaskIds ?? [],
    linkedTaskMeta: meta,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let code: string | null = null;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === 'string') code = body.error;
    } catch {
      // Not JSON; the status is the whole story.
    }
    throw new NoteApiError(res.status, code);
  }
  return (await res.json()) as T;
}

const notePath = (id: string) => `/notes/${encodeURIComponent(id)}`;

/**
 * Every note on the server, pinned first then most recent.
 *
 * @returns The notes / ノート一覧
 * @throws {NoteApiError} when the server refuses / サーバーが拒否したとき
 */
export async function fetchNotes(): Promise<Note[]> {
  const body = await request<{ notes: ServerNote[] }>('/notes');
  return body.notes.map(fromServerNote);
}

/**
 * Create or update a note under the caller's id, sending only `fields`.
 *
 * @param id - The note id / ノートID
 * @param fields - The fields to set / 設定する項目
 * @returns The stored note / 保存後のノート
 * @throws {NoteApiError} 400 `legacy_html_content` for an HTML body, 409 on a write conflict / HTML 本文は 400、競合は 409
 */
export async function saveNoteOnServer(id: string, fields: NoteUpdate): Promise<Note> {
  const body = await request<{ note: ServerNote }>(notePath(id), {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
  return fromServerNote(body.note);
}

/**
 * Delete a note (its links go with it).
 *
 * @param id - The note id / ノートID
 * @throws {NoteApiError} when the server refuses, except a 404 (already gone) / 404 以外の失敗時
 */
export async function deleteNoteOnServer(id: string): Promise<void> {
  try {
    await request(notePath(id), { method: 'DELETE' });
  } catch (err) {
    if (err instanceof NoteApiError && err.status === 404) return;
    throw err;
  }
}

/**
 * Link a note to a task. The server checks the task is in this workspace.
 *
 * @param id - The note id / ノートID
 * @param taskId - The task / タスクID
 * @param meta - Display context / 表示用情報
 * @throws {NoteApiError} 404 when the note or task is not reachable / ノートかタスクが無いとき 404
 */
export async function linkNoteOnServer(
  id: string,
  taskId: number,
  meta?: NoteTaskMeta,
): Promise<void> {
  await request(`${notePath(id)}/links`, {
    method: 'POST',
    body: JSON.stringify({ taskId, ...(meta ? { meta } : {}) }),
  });
}

/**
 * Remove a note-task link.
 *
 * @param id - The note id / ノートID
 * @param taskId - The task / タスクID
 * @throws {NoteApiError} when the server refuses, except a 404 (already unlinked) / 404 以外の失敗時
 */
export async function unlinkNoteOnServer(id: string, taskId: number): Promise<void> {
  try {
    await request(`${notePath(id)}/links/${taskId}`, { method: 'DELETE' });
  } catch (err) {
    if (err instanceof NoteApiError && err.status === 404) return;
    throw err;
  }
}
