/**
 * copilot-note
 *
 * Turns one of ラピ's text replies in the copilot panel into a note: the
 * draft from `POST /notes/draft-from-reply` (a generated title and the
 * answer tidied into a document), the `PUT /notes/:id` write and the task link.
 * Not responsible for the button or its feedback — see `SaveToNoteButton`.
 *
 * NOTE: the note used to be built here from the question and the reply
 * ("## 質問" / "## ラピの回答", titled with the question). Since nav70 only
 * the answer is sent and saved; the question is not gathered at all.
 */
import { API_BASE_URL } from '@/utils/api';
import { useNoteStore, type Note } from '@/stores/note-store';

/** The note drafted from one reply, ready to save. */
export interface CopilotNoteDraft {
  title: string;
  content: string;
}

/**
 * What the save did. `linked` is null when there was no task to link to.
 * `mirrored` is false when the server has the note but this browser's copy
 * could not be stored; the save still counts as done.
 */
export interface CopilotNoteSaveResult {
  noteId: string;
  linked: boolean | null;
  mirrored: boolean;
}

/**
 * Asks the server to draft a note from ラピ's reply: a title that fits it and
 * the reply tidied into a document. Nothing is saved yet.
 *
 * @param answer - ラピ's reply, Markdown as-is / ラピの返答（Markdown のまま）
 * @returns title and body to save / 保存するタイトルと本文
 * @throws {Error} when no usable draft came back (the caller saves nothing) / 下書きが得られなかったとき（呼び出し側は保存しない）
 */
export async function draftCopilotNote(answer: string): Promise<CopilotNoteDraft> {
  const res = await fetch(`${API_BASE_URL}/notes/draft-from-reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer }),
  });
  if (!res.ok) throw new Error(`note draft failed: HTTP ${res.status}`);
  const body: unknown = await res.json();
  const { title, content } = (body ?? {}) as { title?: unknown; content?: unknown };
  if (typeof title !== 'string' || typeof content !== 'string' || !content.trim()) {
    throw new Error('note draft failed: no title or body');
  }
  return { title, content };
}

/**
 * Puts the saved note into this browser's note store too.
 *
 * NOTE: the desktop notes page and modal still read only the local store
 * (`note-store.ts` persists to localStorage), so without this the note would
 * exist on the server — and on the phone — but not on the screen it was
 * saved from. Same id, so a later `/notes/import` skips it.
 */
function mirrorLocally(id: string, draft: CopilotNoteDraft, taskId: number | null): void {
  const now = new Date();
  const note: Note = {
    id,
    title: draft.title,
    content: draft.content,
    createdAt: now,
    updatedAt: now,
    isPinned: false,
    tags: [],
    ...(taskId !== null ? { linkedTaskIds: [taskId] } : {}),
  };
  useNoteStore.setState((state) => ({
    notes: [note, ...state.notes.filter((n) => n.id !== id)],
  }));
}

/**
 * Saves the note, then links it to the task when there is one.
 *
 * @param draft - title and body / タイトルと本文
 * @param taskId - the panel's task, or null / パネルのタスク（無ければ null）
 * @param now - clock for the id, for tests / id に使う時刻（テスト用）
 * @returns the note id and whether the link went through / ノートの id と紐付けの成否
 * @throws {Error} when the note itself was not saved / ノート自体を保存できなかったとき
 */
export async function saveCopilotNote(
  draft: CopilotNoteDraft,
  taskId: number | null,
  now: () => number = Date.now,
): Promise<CopilotNoteSaveResult> {
  // Same id shape the desktop store mints (Date.now().toString()).
  const noteId = now().toString();
  const res = await fetch(`${API_BASE_URL}/notes/${encodeURIComponent(noteId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: draft.title, content: draft.content }),
  });
  if (!res.ok) throw new Error(`note save failed: HTTP ${res.status}`);

  let linked: boolean | null = null;
  if (taskId !== null) {
    // The note exists by now; a failed link is reported, not treated as a failed save.
    try {
      const link = await fetch(`${API_BASE_URL}/notes/${encodeURIComponent(noteId)}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      linked = link.ok;
    } catch {
      linked = false;
    }
  }
  // NOTE: the server already has the note. A failed local copy (e.g. localStorage
  // quota) must not surface as a failed save, or a retry would mint a second note.
  let mirrored = true;
  try {
    mirrorLocally(noteId, draft, linked ? taskId : null);
  } catch {
    mirrored = false;
  }
  return { noteId, linked, mirrored };
}
