/**
 * note-local-actions
 *
 * The note store's behaviour before this browser's notes are migrated: the
 * pre-stage-0 actions, unchanged, acting on the in-memory list that
 * `note-store.ts` persists to localStorage while the source is `local`.
 * Kept so the screen does not change under a migration in progress
 * (design §5.3 step 7). Not used once the source is the server.
 */
import type { Note, NoteTaskMeta } from './note-types';

interface LocalHost {
  notes: Note[];
  currentNoteId: string | null;
}

type SetLocal = (partial: Partial<LocalHost> | ((state: LocalHost) => Partial<LocalHost>)) => void;

const blankNote = (id: string, title = ''): Note => ({
  id,
  title,
  content: '',
  createdAt: new Date(),
  updatedAt: new Date(),
  isPinned: false,
  tags: [],
});

const isBlank = (n: Note) => n.content.trim() === '' && n.title.trim() === '';

/**
 * The local-mode actions.
 *
 * @param set - The store's set / ストアの set
 * @param get - The store's get / ストアの get
 * @returns The actions / 操作
 */
export function createLocalNoteActions(set: SetLocal, get: () => LocalHost) {
  return {
    createNote: (title?: string): string => {
      // NOTE: Guard against onClick events being passed as title when used as a
      // direct event handler (e.g. onClick={createNote}).
      const safeTitle = typeof title === 'string' ? title : undefined;
      const note = blankNote(Date.now().toString(), safeTitle ?? '');
      set((state) => ({ notes: [note, ...state.notes], currentNoteId: note.id }));
      return note.id;
    },

    updateNote: (id: string, updates: Partial<Note>) => {
      set((state) => {
        let notes = state.notes.map((note) =>
          note.id === id ? { ...note, ...updates, updatedAt: new Date() } : note,
        );
        // A saved note with content gets a fresh empty one beside it.
        const updated = notes.find((n) => n.id === id);
        if (updated && !isBlank(updated) && !notes.some((n) => isBlank(n) && n.id !== id)) {
          notes = [blankNote(Date.now().toString()), ...notes];
        }
        return { notes };
      });
    },

    deleteNote: (id: string) => {
      set((state) => {
        const notes = state.notes.filter((note) => note.id !== id);
        const currentNoteId = state.currentNoteId === id ? null : state.currentNoteId;
        if (!notes.some(isBlank) && notes.length > 0) {
          notes.unshift(blankNote(Date.now().toString() + '-delete'));
        }
        return { notes, currentNoteId };
      });
    },

    setCurrentNote: (id: string | null) => {
      set({ currentNoteId: id });
      if (!id) return;
      const state = get();
      const current = state.notes.find((n) => n.id === id);
      if (current && isBlank(current) && !state.notes.some((n) => isBlank(n) && n.id !== id)) {
        const note = blankNote(Date.now().toString() + '-auto');
        set((s) => ({ notes: [note, ...s.notes] }));
      }
    },

    linkNoteToTask: (noteId: string, taskId: number, meta?: NoteTaskMeta) => {
      set((state) => ({
        notes: state.notes.map((n) =>
          n.id === noteId
            ? {
                ...n,
                linkedTaskIds: [...new Set([...(n.linkedTaskIds ?? []), taskId])],
                ...(meta
                  ? { linkedTaskMeta: { ...(n.linkedTaskMeta ?? {}), [taskId]: meta } }
                  : {}),
              }
            : n,
        ),
      }));
    },

    unlinkNoteFromTask: (noteId: string, taskId: number) => {
      set((state) => ({
        notes: state.notes.map((n) => {
          if (n.id !== noteId) return n;
          const meta = { ...(n.linkedTaskMeta ?? {}) };
          delete meta[taskId];
          return {
            ...n,
            linkedTaskIds: (n.linkedTaskIds ?? []).filter((t) => t !== taskId),
            linkedTaskMeta: meta,
          };
        }),
      }));
    },
  };
}
