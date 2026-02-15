import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  isPinned: boolean;
  tags: string[];
  color?: string;
}

export type ModalTab = "note" | "ai";

export interface NoteModalState {
  isOpen: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
  activeTab: ModalTab;
}

interface NoteState {
  notes: Note[];
  currentNoteId: string | null;
  modalState: NoteModalState;
  searchQuery: string;
  selectedTags: string[];

  // Note operations
  createNote: () => void;
  updateNote: (id: string, updates: Partial<Note>) => void;
  deleteNote: (id: string) => void;
  setCurrentNote: (id: string | null) => void;

  // Modal operations
  toggleModal: () => void;
  openModal: (tab?: ModalTab) => void;
  closeModal: () => void;
  setModalPosition: (x: number, y: number) => void;
  setModalSize: (width: number, height: number) => void;
  toggleMinimize: () => void;
  toggleMaximize: () => void;
  bringToFront: () => void;
  setModalTab: (tab: ModalTab) => void;

  // Search and filter
  setSearchQuery: (query: string) => void;
  toggleTag: (tag: string) => void;
  clearFilters: () => void;

  // Get filtered notes
  getFilteredNotes: () => Note[];
  getAllTags: () => string[];
}

let nextZIndex = 1000;

const defaultModalState: NoteModalState = {
  isOpen: false,
  position: { x: 100, y: 100 },
  size: { width: 600, height: 500 },
  isMinimized: false,
  isMaximized: false,
  zIndex: 1000,
  activeTab: "note",
};

export const useNoteStore = create<NoteState>()(
  persist(
    (set, get) => ({
      notes: [],
      currentNoteId: null,
      modalState: defaultModalState,
      searchQuery: "",
      selectedTags: [],

      createNote: () => {
        const newNote: Note = {
          id: Date.now().toString(),
          title: "新しいノート",
          content: "",
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
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === id
              ? { ...note, ...updates, updatedAt: new Date() }
              : note
          ),
        }));
      },

      deleteNote: (id) => {
        set((state) => {
          const newNotes = state.notes.filter((note) => note.id !== id);
          const currentNote = state.currentNoteId === id ? null : state.currentNoteId;
          return { notes: newNotes, currentNoteId: currentNote };
        });
      },

      setCurrentNote: (id) => {
        set({ currentNoteId: id });
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
              isMinimized: false,
            },
          });
          // ノートが無い場合は新規作成
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
            isMinimized: false,
            ...(tab ? { activeTab: tab } : {}),
          },
        }));
        const state = get();
        if ((!tab || tab === "note") && state.notes.length === 0) {
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

      toggleMinimize: () => {
        const ICON_SIZE = 32;
        set((state) => {
          const { position, size, isMinimized } = state.modalState;
          if (!isMinimized) {
            // モーダル → アイコン: モーダルの右下 = アイコンの右上
            return {
              modalState: {
                ...state.modalState,
                isMinimized: true,
                position: {
                  x: position.x + size.width - ICON_SIZE,
                  y: position.y + size.height,
                },
              },
            };
          }
          // アイコン → モーダル: アイコンの右上 = モーダルの右下
          return {
            modalState: {
              ...state.modalState,
              isMinimized: false,
              position: {
                x: position.x + ICON_SIZE - size.width,
                y: position.y - size.height,
              },
            },
          };
        });
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

      clearFilters: () => {
        set({ searchQuery: "", selectedTags: [] });
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
              note.tags.some((tag) => tag.toLowerCase().includes(query))
          );
        }

        // Tag filter
        if (state.selectedTags.length > 0) {
          filtered = filtered.filter((note) =>
            state.selectedTags.every((tag) => note.tags.includes(tag))
          );
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
      name: "note-storage",
      partialize: (state) => ({
        notes: state.notes,
        currentNoteId: state.currentNoteId,
      }),
    }
  )
);