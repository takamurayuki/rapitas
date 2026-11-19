/**
 * note-local-backup
 *
 * The browser's own copy of the notes (localStorage `note-storage`, the
 * format zustand's `persist` wrote). Before the migration it is still the
 * desktop's note store; after it, a read-only backup the migration reads and
 * that a person may delete. Not responsible for deciding which applies — see
 * `note-migration-record.ts`.
 */
import type { Note } from './note-types';

/** The key the pre-stage-0 store persisted to; kept so existing data is found. */
export const LOCAL_NOTE_STORAGE_KEY = 'note-storage';

/** What the browser holds. */
export interface LocalNoteSnapshot {
  notes: Note[];
  currentNoteId: string | null;
}

const EMPTY: LocalNoteSnapshot = { notes: [], currentNoteId: null };

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function reviveNote(raw: Record<string, unknown>): Note {
  return {
    ...(raw as unknown as Note),
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    createdAt: new Date(String(raw.createdAt ?? 0)),
    updatedAt: new Date(String(raw.updatedAt ?? 0)),
  };
}

/**
 * Read the browser's notes. A missing or unreadable entry is no notes.
 *
 * @returns The notes and the last open note / ノートと最後に開いていたノート
 */
export function readLocalNotes(): LocalNoteSnapshot {
  const raw = storage()?.getItem(LOCAL_NOTE_STORAGE_KEY);
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as { state?: { notes?: unknown; currentNoteId?: unknown } };
    const notes = Array.isArray(parsed.state?.notes) ? parsed.state.notes : [];
    return {
      notes: notes.map((n) => reviveNote(n as Record<string, unknown>)),
      currentNoteId:
        typeof parsed.state?.currentNoteId === 'string' ? parsed.state.currentNoteId : null,
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Write the browser's notes in the persist format. Only the pre-migration
 * local store calls this; after the migration the entry is never written.
 *
 * @param snapshot - The notes to keep / 保存するノート
 */
export function writeLocalNotes(snapshot: LocalNoteSnapshot): void {
  try {
    storage()?.setItem(LOCAL_NOTE_STORAGE_KEY, JSON.stringify({ state: snapshot, version: 0 }));
  } catch {
    // Quota or private mode: the notes stay in memory for this session.
  }
}

/**
 * Whether a note carries anything worth moving. The old store made a blank
 * note whenever none existed; those are not migrated.
 *
 * @param note - A local note / ローカルのノート
 * @returns true when it has a title, a body, tags or links / 中身があれば true
 */
export function isMeaningfulNote(note: Note): boolean {
  return (
    note.title.trim() !== '' ||
    note.content.trim() !== '' ||
    note.tags.length > 0 ||
    (note.linkedTaskIds?.length ?? 0) > 0
  );
}

/** Remove the backup (a person's explicit choice, from the migration band). */
export function deleteLocalNotes(): void {
  try {
    storage()?.removeItem(LOCAL_NOTE_STORAGE_KEY);
  } catch {
    // Nothing to remove.
  }
}
