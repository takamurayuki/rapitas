import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface NoteTaskMeta {
  taskTitle: string;
  themeName: string;
  categoryName: string;
}

export const DOC_TYPES = ['要件定義', '設計書', '議事録', '手順書', '仕様書', 'メモ'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  isPinned: boolean;
  tags: string[];
  color?: string;
  /** Document type for organizing design/requirements docs / 要件定義・設計書などの種別 */
  docType?: DocType;
  /** Task IDs this note is linked to. */
  linkedTaskIds?: number[];
  /** Hierarchy metadata keyed by taskId — populated when linking from a task context. */
  linkedTaskMeta?: Record<number, NoteTaskMeta>;
}

export type ModalTab = 'note' | 'ai' | 'split';

/** Which side the Note panel sits on in split view. AI takes the opposite side. */
export type SplitNoteSide = 'left' | 'right';

export interface NoteModalState {
  isOpen: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  isMaximized: boolean;
  zIndex: number;
  activeTab: ModalTab;
  /** Side the Note panel occupies in split view (default 'right'). */
  splitNoteSide: SplitNoteSide;
}

interface NoteState {
  notes: Note[];
  currentNoteId: string | null;
  modalState: NoteModalState;
  searchQuery: string;
  selectedTags: string[];
  selectedDocType: DocType | null;

  // Note operations
  createNote: (title?: string) => void;
  updateNote: (id: string, updates: Partial<Note>) => void;
  deleteNote: (id: string) => void;
  setCurrentNote: (id: string | null) => void;
  linkNoteToTask: (noteId: string, taskId: number, meta?: NoteTaskMeta) => void;
  unlinkNoteFromTask: (noteId: string, taskId: number) => void;
  getNotesForTask: (taskId: number) => Note[];

  // Modal operations
  toggleModal: () => void;
  openModal: (tab?: ModalTab) => void;
  closeModal: () => void;
  setModalPosition: (x: number, y: number) => void;
  setModalSize: (width: number, height: number) => void;
  toggleMaximize: () => void;
  bringToFront: () => void;
  setModalTab: (tab: ModalTab) => void;
  setSplitNoteSide: (side: SplitNoteSide) => void;
  toggleSplitNoteSide: () => void;

  // Search and filter
  setSearchQuery: (query: string) => void;
  toggleTag: (tag: string) => void;
  setSelectedDocType: (docType: DocType | null) => void;
  clearFilters: () => void;

  // Get filtered notes
  getFilteredNotes: () => Note[];
  getAllTags: () => string[];
}

let nextZIndex = 1000;

const defaultModalState: NoteModalState = {
  isOpen: false,
  position: {
    x: typeof window !== 'undefined' ? Math.max(100, (window.innerWidth - 600) / 2) : 100,
    y: typeof window !== 'undefined' ? Math.max(100, (window.innerHeight - 500) / 2) : 100,
  },
  size: { width: 600, height: 500 },
  isMaximized: false,
  zIndex: 1000,
  activeTab: 'note',
  splitNoteSide: 'right',
};

export const useNoteStore = create<NoteState>()(
  persist(
    (set, get) => ({
      notes: [],
      currentNoteId: null,
      modalState: defaultModalState,
      searchQuery: '',
      selectedTags: [],
      selectedDocType: null,

      createNote: (title?: string) => {
        // NOTE: Guard against onClick events being passed as title when used as a
        // direct event handler (e.g. onClick={createNote}).  The MouseEvent is truthy
        // so `title ?? fallback` would store it instead of the fallback string.
        const safeTitle = typeof title === 'string' ? title : undefined;
        const newNote: Note = {
          id: Date.now().toString(),
          title: safeTitle ?? '新しいノート',
          content: '',
          createdAt: new Date(),
          updatedAt: new Date(),
          isPinned: false,
          tags: [],
        };
        set((state) => ({
          notes: [newNote, ...state.notes],
          currentNoteId: newNote.id,
        }));
      },

      updateNote: (id, updates) => {
        set((state) => {
          const newState = {
            notes: state.notes.map((note) =>
              note.id === id ? { ...note, ...updates, updatedAt: new Date() } : note,
            ),
          };

          // If note is saved and content is not empty, auto-create new note if no empty one exists
          const updatedNote = newState.notes.find((n) => n.id === id);
          if (
            updatedNote &&
            (updatedNote.content.trim() !== '' || updatedNote.title !== '新しいノート')
          ) {
            const hasEmptyNote = newState.notes.some(
              (n) => n.content.trim() === '' && n.title === '新しいノート' && n.id !== id,
            );

            if (!hasEmptyNote) {
              const newNote: Note = {
                id: Date.now().toString(),
                title: '新しいノート',
                content: '',
                createdAt: new Date(),
                updatedAt: new Date(),
                isPinned: false,
                tags: [],
              };
              newState.notes = [newNote, ...newState.notes];
            }
          }

          return newState;
        });
      },

      deleteNote: (id) => {
        set((state) => {
          const newNotes = state.notes.filter((note) => note.id !== id);
          const currentNote = state.currentNoteId === id ? null : state.currentNoteId;

          // After deletion, create new empty note if none exists
          const hasEmptyNote = newNotes.some(
            (n) => n.content.trim() === '' && n.title === '新しいノート',
          );

          if (!hasEmptyNote && newNotes.length > 0) {
            const newNote: Note = {
              id: Date.now().toString() + '-delete',
              title: '新しいノート',
              content: '',
              createdAt: new Date(),
              updatedAt: new Date(),
              isPinned: false,
              tags: [],
            };
            newNotes.unshift(newNote);
          }

          return { notes: newNotes, currentNoteId: currentNote };
        });
      },

      setCurrentNote: (id) => {
        set({ currentNoteId: id });

        // When switching to empty note, create new one if no others exist
        if (id) {
          const state = get();
          const currentNote = state.notes.find((n) => n.id === id);
          if (
            currentNote &&
            currentNote.content.trim() === '' &&
            currentNote.title === '新しいノート'
          ) {
            const otherEmptyNote = state.notes.find(
              (n) => n.content.trim() === '' && n.title === '新しいノート' && n.id !== id,
            );
            if (!otherEmptyNote) {
              const newNote: Note = {
                id: Date.now().toString() + '-auto',
                title: '新しいノート',
                content: '',
                createdAt: new Date(),
                updatedAt: new Date(),
                isPinned: false,
                tags: [],
              };
              set((state) => ({
                notes: [newNote, ...state.notes],
              }));
            }
          }
        }
      },

      linkNoteToTask: (noteId, taskId, meta) => {
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

      unlinkNoteFromTask: (noteId, taskId) => {
        set((state) => ({
          notes: state.notes.map((n) => {
            if (n.id !== noteId) return n;
            const newMeta = { ...(n.linkedTaskMeta ?? {}) };
            delete newMeta[taskId];
            return {
              ...n,
              linkedTaskIds: (n.linkedTaskIds ?? []).filter((id) => id !== taskId),
              linkedTaskMeta: newMeta,
            };
          }),
        }));
      },

      getNotesForTask: (taskId) => {
        return get().notes.filter((n) => n.linkedTaskIds?.includes(taskId));
      },

      toggleModal: () => {
        const state = get();
        if (state.modalState.isOpen) {
          set({ modalState: { ...state.modalState, isOpen: false } });
        } else {
          set({
            modalState: {
              ...state.modalState,
              isOpen: true,
              zIndex: ++nextZIndex,
            },
          });
          // Create new note if none exists
          if (state.notes.length === 0) {
            get().createNote();
          }
        }
      },

      openModal: (tab) => {
        set((state) => ({
          modalState: {
            ...state.modalState,
            isOpen: true,
            zIndex: ++nextZIndex,
            ...(tab ? { activeTab: tab } : {}),
          },
        }));
        const state = get();
        // Create new note if none exists
        if ((!tab || tab === 'note') && state.notes.length === 0) {
          get().createNote();
        }
      },

      closeModal: () => {
        set((state) => ({
          modalState: { ...state.modalState, isOpen: false },
        }));
      },

      setModalPosition: (x, y) => {
        set((state) => ({
          modalState: { ...state.modalState, position: { x, y } },
        }));
      },

      setModalSize: (width, height) => {
        set((state) => ({
          modalState: { ...state.modalState, size: { width, height } },
        }));
      },

      toggleMaximize: () => {
        set((state) => ({
          modalState: {
            ...state.modalState,
            isMaximized: !state.modalState.isMaximized,
          },
        }));
      },

      bringToFront: () => {
        set((state) => ({
          modalState: { ...state.modalState, zIndex: ++nextZIndex },
        }));
      },

      setModalTab: (tab) => {
        set((state) => ({
          modalState: { ...state.modalState, activeTab: tab },
        }));
      },

      setSplitNoteSide: (side) => {
        set((state) => ({
          modalState: { ...state.modalState, splitNoteSide: side },
        }));
      },

      toggleSplitNoteSide: () => {
        set((state) => ({
          modalState: {
            ...state.modalState,
            splitNoteSide: state.modalState.splitNoteSide === 'right' ? 'left' : 'right',
          },
        }));
      },

      setSearchQuery: (query) => {
        set({ searchQuery: query });
      },

      toggleTag: (tag) => {
        set((state) => {
          const tags = state.selectedTags.includes(tag)
            ? state.selectedTags.filter((t) => t !== tag)
            : [...state.selectedTags, tag];
          return { selectedTags: tags };
        });
      },

      setSelectedDocType: (docType) => {
        set({ selectedDocType: docType });
      },

      clearFilters: () => {
        set({ searchQuery: '', selectedTags: [], selectedDocType: null });
      },

      getFilteredNotes: () => {
        const state = get();
        let filtered = [...state.notes];

        // Search filter
        if (state.searchQuery) {
          const query = state.searchQuery.toLowerCase();
          filtered = filtered.filter(
            (note) =>
              note.title.toLowerCase().includes(query) ||
              note.content.toLowerCase().includes(query) ||
              note.tags.some((tag) => tag.toLowerCase().includes(query)),
          );
        }

        // Tag filter
        if (state.selectedTags.length > 0) {
          filtered = filtered.filter((note) =>
            state.selectedTags.every((tag) => note.tags.includes(tag)),
          );
        }

        // DocType filter
        if (state.selectedDocType) {
          filtered = filtered.filter((note) => note.docType === state.selectedDocType);
        }

        // Sort by pinned first, then by updatedAt
        return filtered.sort((a, b) => {
          if (a.isPinned !== b.isPinned) {
            return a.isPinned ? -1 : 1;
          }
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });
      },

      getAllTags: () => {
        const state = get();
        const tagSet = new Set<string>();
        state.notes.forEach((note) => {
          note.tags?.forEach((tag) => tagSet.add(tag));
        });
        return Array.from(tagSet).sort();
      },
    }),
    {
      name: 'note-storage',
      partialize: (state) => ({
        notes: state.notes,
        currentNoteId: state.currentNoteId,
      }),
    },
  ),
);
