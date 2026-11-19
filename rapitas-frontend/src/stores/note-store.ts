/**
 * note-store
 *
 * The desktop's notes: the list the /notes page, its sidebar, the note modal
 * and the task detail read, and the actions that change them.
 *
 * Since stage 0 the source is the server (`/notes`): every change is sent to
 * the API, in order per note, and the list is loaded from it. Until this
 * browser's own notes have been migrated (`note-migration` says done), the
 * store keeps the old behaviour on the local copy (localStorage
 * `note-storage`) so the screen does not change under the migration
 * (design §5.3 step 7); after that the local copy is a read-only backup that
 * is never written again.
 *
 * Not responsible for the migration itself — see components/note/migration.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import type { Note, NoteSource, NoteTaskMeta, NoteUpdate } from './note/note-types';
import { createNoteModalSlice, type NoteModalSlice } from './note/note-modal-slice';
import { createLocalNoteActions } from './note/note-local-actions';
import {
  deleteNoteOnServer,
  fetchNotes,
  linkNoteOnServer,
  NoteApiError,
  saveNoteOnServer,
  unlinkNoteOnServer,
} from './note/note-api';
import { isMeaningfulNote, readLocalNotes, writeLocalNotes } from './note/note-local-backup';
import { isNoteMigrationDone } from './note/note-migration-record';

export type { Note, NoteTaskMeta, DocType, NoteSource } from './note/note-types';
export { DOC_TYPES } from './note/note-types';
export type { ModalTab, SplitNoteSide, NoteModalState } from './note/note-modal-slice';

/** Why the last server write or load did not go through. */
export type NoteSyncError =
  | 'load_failed'
  | 'save_failed'
  | 'legacy_html'
  | 'conflict'
  | 'link_failed';

export interface NoteDataState {
  notes: Note[];
  currentNoteId: string | null;
  source: NoteSource;
  loadState: 'idle' | 'loading' | 'ready' | 'error';
  loadedAt: number;
  syncError: NoteSyncError | null;

  /** Make a note and open it; returns its id. */
  createNote: (title?: string) => string;
  updateNote: (id: string, updates: Partial<Note>) => void;
  deleteNote: (id: string) => void;
  setCurrentNote: (id: string | null) => void;
  /** Resolves false when the server refused (e.g. the task is not in this workspace). */
  linkNoteToTask: (noteId: string, taskId: number, meta?: NoteTaskMeta) => Promise<boolean>;
  unlinkNoteFromTask: (noteId: string, taskId: number) => void;
  getNotesForTask: (taskId: number) => Note[];

  loadNotes: () => Promise<void>;
  /** Load when nothing was loaded yet or the list is older than `maxAgeMs`. */
  ensureLoaded: (maxAgeMs?: number) => void;
  /** Called once the migration is done: drop the local copy, read the server. */
  switchToServer: () => Promise<void>;
  /** Put a note another module already saved on the server into the list. */
  upsertNote: (note: Note) => void;
  clearSyncError: () => void;
  onOpenEmpty: () => void;
}

export type NoteState = NoteDataState & NoteModalSlice;

const WRITABLE: (keyof NoteUpdate)[] = ['title', 'content', 'isPinned', 'tags', 'color', 'docType'];

function pickWritable(updates: Partial<Note>): NoteUpdate {
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE) if (updates[key] !== undefined) out[key] = updates[key];
  return out as NoteUpdate;
}

function syncErrorOf(err: unknown, fallback: NoteSyncError): NoteSyncError {
  if (err instanceof NoteApiError) {
    if (err.code === 'legacy_html_content') return 'legacy_html';
    if (err.status === 409) return 'conflict';
  }
  return fallback;
}

/** Per-note write queues, so two saves of one note reach the server in order. */
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  queues.set(id, next);
  // Forget a settled queue, so "still has a write in flight" stays meaningful.
  const forget = () => {
    if (queues.get(id) === next) queues.delete(id);
  };
  next.then(forget, forget);
  return next;
}

function initialData(): Pick<NoteDataState, 'notes' | 'currentNoteId' | 'source'> {
  if (typeof window === 'undefined') return { notes: [], currentNoteId: null, source: 'server' };
  const local = readLocalNotes();
  if (isNoteMigrationDone() || !local.notes.some(isMeaningfulNote)) {
    return { notes: [], currentNoteId: null, source: 'server' };
  }
  return { notes: local.notes, currentNoteId: local.currentNoteId, source: 'local' };
}

export const useNoteStore = create<NoteState>()((set, get) => {
  const local = createLocalNoteActions(set, get);
  const isLocal = () => get().source === 'local';
  const replaceNote = (id: string, fn: (n: Note) => Note) =>
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? fn(n) : n)) }));

  /** Send fields for one note and take the server's timestamps back. */
  const send = (id: string, fields: NoteUpdate) =>
    enqueue(id, async () => {
      try {
        const saved = await saveNoteOnServer(id, fields);
        replaceNote(id, (n) => ({ ...n, createdAt: saved.createdAt, updatedAt: saved.updatedAt }));
      } catch (err) {
        set({ syncError: syncErrorOf(err, 'save_failed') });
        // The list no longer matches the server; read it again.
        void get().loadNotes();
      }
    });

  return {
    ...createNoteModalSlice({ set, get }),
    ...initialData(),
    loadState: 'idle',
    loadedAt: 0,
    syncError: null,

    createNote: (title?: string) => {
      if (isLocal()) return local.createNote(title);
      // NOTE: Guard against onClick events being passed as title (onClick={createNote}).
      const safeTitle = typeof title === 'string' ? title : '';
      const now = new Date();
      const note: Note = {
        id: Date.now().toString(),
        title: safeTitle,
        content: '',
        createdAt: now,
        updatedAt: now,
        isPinned: false,
        tags: [],
      };
      set((s) => ({ notes: [note, ...s.notes], currentNoteId: note.id }));
      // An empty Markdown body is a valid note, so it is created right away
      // and a link made straight after (NoteLinksSection) finds it.
      void send(note.id, { title: safeTitle, content: '' });
      return note.id;
    },

    updateNote: (id, updates) => {
      if (isLocal()) return local.updateNote(id, updates);
      replaceNote(id, (n) => ({ ...n, ...updates, updatedAt: new Date() }));
      const fields = pickWritable(updates);
      if (Object.keys(fields).length > 0) void send(id, fields);
    },

    deleteNote: (id) => {
      if (isLocal()) return local.deleteNote(id);
      set((s) => ({
        notes: s.notes.filter((n) => n.id !== id),
        currentNoteId: s.currentNoteId === id ? null : s.currentNoteId,
      }));
      void enqueue(id, () => deleteNoteOnServer(id)).catch((err) => {
        set({ syncError: syncErrorOf(err, 'save_failed') });
        void get().loadNotes();
      });
    },

    setCurrentNote: (id) => {
      if (isLocal()) return local.setCurrentNote(id);
      set({ currentNoteId: id });
    },

    linkNoteToTask: async (noteId, taskId, meta) => {
      if (isLocal()) {
        local.linkNoteToTask(noteId, taskId, meta);
        return true;
      }
      const before = get().notes.find((n) => n.id === noteId);
      replaceNote(noteId, (n) => ({
        ...n,
        linkedTaskIds: [...new Set([...(n.linkedTaskIds ?? []), taskId])],
        ...(meta ? { linkedTaskMeta: { ...(n.linkedTaskMeta ?? {}), [taskId]: meta } } : {}),
      }));
      try {
        await enqueue(noteId, () => linkNoteOnServer(noteId, taskId, meta));
        return true;
      } catch {
        if (before) replaceNote(noteId, () => before);
        set({ syncError: 'link_failed' });
        return false;
      }
    },

    unlinkNoteFromTask: (noteId, taskId) => {
      local.unlinkNoteFromTask(noteId, taskId);
      if (isLocal()) return;
      void enqueue(noteId, () => unlinkNoteOnServer(noteId, taskId)).catch(() => {
        set({ syncError: 'link_failed' });
        void get().loadNotes();
      });
    },

    getNotesForTask: (taskId) => get().notes.filter((n) => n.linkedTaskIds?.includes(taskId)),

    loadNotes: async () => {
      if (isLocal()) return;
      set({ loadState: 'loading' });
      try {
        const notes = await fetchNotes();
        // A note created here but not yet acknowledged stays in the list.
        const pending = get().notes.filter(
          (n) => queues.has(n.id) && !notes.some((s) => s.id === n.id),
        );
        set({ notes: [...pending, ...notes], loadState: 'ready', loadedAt: Date.now() });
      } catch {
        set({ loadState: 'error', syncError: 'load_failed' });
      }
    },

    ensureLoaded: (maxAgeMs = 30_000) => {
      const s = get();
      if (s.source !== 'server' || s.loadState === 'loading') return;
      if (s.loadState === 'ready' && Date.now() - s.loadedAt < maxAgeMs) return;
      void s.loadNotes();
    },

    switchToServer: async () => {
      set({ source: 'server', notes: [], currentNoteId: null, loadState: 'idle', loadedAt: 0 });
      await get().loadNotes();
    },

    upsertNote: (note) =>
      set((s) => ({ notes: [note, ...s.notes.filter((n) => n.id !== note.id)] })),

    clearSyncError: () => set({ syncError: null }),

    onOpenEmpty: () => {
      // NOTE: the server-backed modal opens on its empty state instead of
      // creating a blank note on the server for every open.
      if (isLocal()) local.createNote();
    },
  };
});

// The local copy is the store's persistence only before the migration; once
// the source is the server it is a backup and is not written again.
useNoteStore.subscribe((state, prev) => {
  if (state.source !== 'local') return;
  if (state.notes === prev.notes && state.currentNoteId === prev.currentNoteId) return;
  writeLocalNotes({ notes: state.notes, currentNoteId: state.currentNoteId });
});

/**
 * Load the server's notes when a screen that shows them mounts.
 *
 * @param maxAgeMs - Reuse a list loaded this recently / この時間内の一覧は再取得しない
 */
export function useEnsureNotesLoaded(maxAgeMs?: number): void {
  useEffect(() => {
    useNoteStore.getState().ensureLoaded(maxAgeMs);
  }, [maxAgeMs]);
}
