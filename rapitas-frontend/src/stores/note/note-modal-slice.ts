/**
 * note-modal-slice
 *
 * The floating note modal's window state and its search / tag / type
 * filters — the part of the note store that never touches note data's
 * source. Split out of `note-store.ts` so the store file stays about notes.
 */
import type { DocType, Note } from './note-types';

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

export interface NoteModalSlice {
  modalState: NoteModalState;
  searchQuery: string;
  selectedTags: string[];
  selectedDocType: DocType | null;
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
  setSearchQuery: (query: string) => void;
  toggleTag: (tag: string) => void;
  setSelectedDocType: (docType: DocType | null) => void;
  clearFilters: () => void;
  getFilteredNotes: () => Note[];
  getAllTags: () => string[];
}

/** What the slice needs from the rest of the store. */
interface NoteSliceHost {
  notes: Note[];
  /** Called when the modal opens with no notes; the store decides what that means. */
  onOpenEmpty: () => void;
}

let nextZIndex = 1000;

export const defaultModalState: NoteModalState = {
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

type SliceHost = NoteModalSlice & NoteSliceHost;

/** The two store functions the slice is built from (zustand's `set` / `get`). */
interface SliceTools {
  set: (partial: (state: SliceHost) => Partial<NoteModalSlice>) => void;
  get: () => SliceHost;
}

/**
 * The modal and filter slice.
 *
 * @param tools - The store's set and get / ストアの set と get
 * @returns The slice / スライス
 */
export function createNoteModalSlice({ set, get }: SliceTools): NoteModalSlice {
  const setModal = (patch: Partial<NoteModalState>) =>
    set((state) => ({ modalState: { ...state.modalState, ...patch } }));
  return {
    modalState: defaultModalState,
    searchQuery: '',
    selectedTags: [],
    selectedDocType: null,

    toggleModal: () => {
      const state = get();
      if (state.modalState.isOpen) {
        setModal({ isOpen: false });
        return;
      }
      setModal({ isOpen: true, zIndex: ++nextZIndex });
      if (state.notes.length === 0) state.onOpenEmpty();
    },

    openModal: (tab) => {
      setModal({ isOpen: true, zIndex: ++nextZIndex, ...(tab ? { activeTab: tab } : {}) });
      const state = get();
      if ((!tab || tab === 'note') && state.notes.length === 0) state.onOpenEmpty();
    },

    closeModal: () => setModal({ isOpen: false }),
    setModalPosition: (x, y) => setModal({ position: { x, y } }),
    setModalSize: (width, height) => setModal({ size: { width, height } }),
    toggleMaximize: () => setModal({ isMaximized: !get().modalState.isMaximized }),
    bringToFront: () => setModal({ zIndex: ++nextZIndex }),
    setModalTab: (tab) => setModal({ activeTab: tab }),
    setSplitNoteSide: (side) => setModal({ splitNoteSide: side }),
    toggleSplitNoteSide: () =>
      setModal({ splitNoteSide: get().modalState.splitNoteSide === 'right' ? 'left' : 'right' }),

    setSearchQuery: (query) => set(() => ({ searchQuery: query })),
    toggleTag: (tag) =>
      set((s) => ({
        selectedTags: s.selectedTags.includes(tag)
          ? s.selectedTags.filter((t) => t !== tag)
          : [...s.selectedTags, tag],
      })),
    setSelectedDocType: (docType) => set(() => ({ selectedDocType: docType })),
    clearFilters: () => set(() => ({ searchQuery: '', selectedTags: [], selectedDocType: null })),

    getFilteredNotes: () => {
      const state = get();
      let filtered = [...state.notes];
      if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase();
        filtered = filtered.filter(
          (note) =>
            note.title.toLowerCase().includes(query) ||
            note.content.toLowerCase().includes(query) ||
            note.tags.some((tag) => tag.toLowerCase().includes(query)),
        );
      }
      if (state.selectedTags.length > 0) {
        filtered = filtered.filter((note) =>
          state.selectedTags.every((tag) => note.tags.includes(tag)),
        );
      }
      if (state.selectedDocType) {
        filtered = filtered.filter((note) => note.docType === state.selectedDocType);
      }
      return filtered.sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    },

    getAllTags: () => {
      const tagSet = new Set<string>();
      get().notes.forEach((note) => note.tags?.forEach((tag) => tagSet.add(tag)));
      return Array.from(tagSet).sort();
    },
  };
}
