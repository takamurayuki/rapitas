/**
 * copilot-note
 *
 * Turns one of ラピ's text replies in the copilot panel into a note: the
 * title and Markdown body, the `PUT /notes/:id` write and the task link.
 * Not responsible for the button or its feedback — see `SaveToNoteButton`.
 */
import { API_BASE_URL } from '@/utils/api';
import { useNoteStore, type Note } from '@/stores/note-store';
import type { CopilotMessage } from './useCopilotChat';

/** Title length before it is cut with an ellipsis. */
export const NOTE_TITLE_MAX = 30;

/** Title used when neither the question nor the reply has a line to use. */
export const NOTE_FALLBACK_TITLE = 'ラピとの会話';

/** The note built from one exchange. */
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

/** First non-empty line, with leading Markdown markers (#, >, -, *) removed. */
function firstLine(text: string): string {
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[\s#>*-]+/, '').trim();
    if (line) return line;
  }
  return '';
}

function shorten(line: string): string {
  const chars = Array.from(line);
  return chars.length > NOTE_TITLE_MAX ? `${chars.slice(0, NOTE_TITLE_MAX).join('')}…` : line;
}

/**
 * Builds the note for one question and ラピ's reply to it.
 *
 * @param question - the user's words just before the reply, if any / 直前のユーザーの発言（無ければ null）
 * @param answer - ラピ's reply, Markdown as-is / ラピの返答（Markdown のまま）
 * @returns title and body / タイトルと本文
 */
export function buildCopilotNote(question: string | null, answer: string): CopilotNoteDraft {
  const asked = question?.trim() ?? '';
  const title = shorten(firstLine(asked) || firstLine(answer)) || NOTE_FALLBACK_TITLE;
  const sections = [...(asked ? ['## 質問', asked] : []), '## ラピの回答', answer.trim()];
  return { title, content: `${sections.join('\n\n')}\n` };
}

/**
 * The user's words the reply answers: the nearest user line before it.
 *
 * @param messages - the panel's lines in order / パネルの発言（並び順）
 * @param replyId - id of ラピ's reply / ラピの返答の id
 * @returns the question, or null when there is none / 質問。無ければ null
 */
export function questionBefore(messages: CopilotMessage[], replyId: string): string | null {
  const index = messages.findIndex((m) => m.id === replyId);
  for (let i = index - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return null;
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
