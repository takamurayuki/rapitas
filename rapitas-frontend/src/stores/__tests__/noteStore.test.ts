import { useNoteStore } from '../noteStore';

describe('noteStore', () => {
  beforeEach(() => {
    useNoteStore.setState({
      notes: [],
      currentNoteId: null,
      modalState: {
        isOpen: false,
        position: { x: 100, y: 100 },
        size: { width: 600, height: 500 },
        isMaximized: false,
        zIndex: 1000,
        activeTab: 'note',
      },
      searchQuery: '',
      selectedTags: [],
    });
  });

  it('should have correct initial state', () => {
    const state = useNoteStore.getState();
    expect(state.notes).toEqual([]);
    expect(state.currentNoteId).toBeNull();
    expect(state.modalState.isOpen).toBe(false);
    expect(state.searchQuery).toBe('');
    expect(state.selectedTags).toEqual([]);
  });

  describe('createNote', () => {
    it('should create a new note and set it as current', () => {
      useNoteStore.getState().createNote();
      const state = useNoteStore.getState();
      expect(state.notes).toHaveLength(1);
      expect(state.notes[0].title).toBe('新しいノート');
      expect(state.notes[0].content).toBe('');
      expect(state.notes[0].isPinned).toBe(false);
      expect(state.notes[0].tags).toEqual([]);
      expect(state.currentNoteId).toBe(state.notes[0].id);
    });
  });

  describe('updateNote', () => {
    it('should update a note by id', () => {
      // Set a note with a known unique ID to avoid Date.now() collision
      useNoteStore.setState({
        notes: [
          {
            id: 'test-note-1',
            title: '新しいノート',
            content: '',
            createdAt: new Date(),
            updatedAt: new Date(),
            isPinned: false,
            tags: [],
          },
        ],
        currentNoteId: 'test-note-1',
      });
      useNoteStore.getState().updateNote('test-note-1', { title: 'Updated' });
      const updated = useNoteStore.getState().notes.find((n) => n.id === 'test-note-1');
      expect(updated?.title).toBe('Updated');
    });

    it('should auto-create a new empty note when updating content of a note', () => {
      useNoteStore.setState({
        notes: [
          {
            id: 'test-note-2',
            title: '新しいノート',
            content: '',
            createdAt: new Date(),
            updatedAt: new Date(),
            isPinned: false,
            tags: [],
          },
        ],
        currentNoteId: 'test-note-2',
      });
      useNoteStore.getState().updateNote('test-note-2', { content: 'Some content' });
      // Should have the original note + auto-created empty note
      const state = useNoteStore.getState();
      expect(state.notes.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('deleteNote', () => {
    it('should delete a note by id', () => {
      useNoteStore.getState().createNote();
      useNoteStore.getState().createNote();
      const noteId = useNoteStore.getState().notes[0].id;
      useNoteStore.getState().deleteNote(noteId);
      expect(useNoteStore.getState().notes.find((n) => n.id === noteId)).toBeUndefined();
    });

    it('should clear currentNoteId when deleting the current note', () => {
      useNoteStore.getState().createNote();
      const noteId = useNoteStore.getState().currentNoteId!;
      useNoteStore.getState().deleteNote(noteId);
      expect(useNoteStore.getState().currentNoteId).toBeNull();
    });
  });

  describe('setCurrentNote', () => {
    it('should set the current note id', () => {
      useNoteStore.getState().createNote();
      const noteId = useNoteStore.getState().notes[0].id;
      useNoteStore.getState().setCurrentNote(noteId);
      expect(useNoteStore.getState().currentNoteId).toBe(noteId);
    });

    it('should set currentNoteId to null', () => {
      useNoteStore.getState().setCurrentNote(null);
      expect(useNoteStore.getState().currentNoteId).toBeNull();
    });
  });

  describe('modal operations', () => {
    it('toggleModal should open the modal', () => {
      useNoteStore.getState().toggleModal();
      expect(useNoteStore.getState().modalState.isOpen).toBe(true);
    });

    it('toggleModal should close the modal when open', () => {
      useNoteStore.getState().toggleModal(); // open
      useNoteStore.getState().toggleModal(); // close
      expect(useNoteStore.getState().modalState.isOpen).toBe(false);
    });

    it('openModal should open the modal', () => {
      useNoteStore.getState().openModal();
      expect(useNoteStore.getState().modalState.isOpen).toBe(true);
    });

    it('openModal with tab should set activeTab', () => {
      useNoteStore.getState().openModal('ai');
      const state = useNoteStore.getState();
      expect(state.modalState.isOpen).toBe(true);
      expect(state.modalState.activeTab).toBe('ai');
    });

    it('closeModal should close the modal', () => {
      useNoteStore.getState().openModal();
      useNoteStore.getState().closeModal();
      expect(useNoteStore.getState().modalState.isOpen).toBe(false);
    });

    it('setModalPosition should update position', () => {
      useNoteStore.getState().setModalPosition(200, 300);
      const pos = useNoteStore.getState().modalState.position;
      expect(pos).toEqual({ x: 200, y: 300 });
    });

    it('setModalSize should update size', () => {
      useNoteStore.getState().setModalSize(800, 600);
      const size = useNoteStore.getState().modalState.size;
      expect(size).toEqual({ width: 800, height: 600 });
    });

    it('toggleMaximize should toggle isMaximized', () => {
      useNoteStore.getState().toggleMaximize();
      expect(useNoteStore.getState().modalState.isMaximized).toBe(true);
      useNoteStore.getState().toggleMaximize();
      expect(useNoteStore.getState().modalState.isMaximized).toBe(false);
    });

    it('bringToFront should increment zIndex', () => {
      const zBefore = useNoteStore.getState().modalState.zIndex;
      useNoteStore.getState().bringToFront();
      expect(useNoteStore.getState().modalState.zIndex).toBeGreaterThan(zBefore);
    });

    it('setModalTab should change activeTab', () => {
      useNoteStore.getState().setModalTab('ai');
      expect(useNoteStore.getState().modalState.activeTab).toBe('ai');
    });
  });

  describe('search and filter', () => {
    it('setSearchQuery should update searchQuery', () => {
      useNoteStore.getState().setSearchQuery('test');
      expect(useNoteStore.getState().searchQuery).toBe('test');
    });

    it('toggleTag should add a tag', () => {
      useNoteStore.getState().toggleTag('work');
      expect(useNoteStore.getState().selectedTags).toContain('work');
    });

    it('toggleTag should remove an existing tag', () => {
      useNoteStore.getState().toggleTag('work');
      useNoteStore.getState().toggleTag('work');
      expect(useNoteStore.getState().selectedTags).not.toContain('work');
    });

    it('clearFilters should reset search and tags', () => {
      useNoteStore.getState().setSearchQuery('test');
      useNoteStore.getState().toggleTag('work');
      useNoteStore.getState().clearFilters();
      expect(useNoteStore.getState().searchQuery).toBe('');
      expect(useNoteStore.getState().selectedTags).toEqual([]);
    });
  });

  describe('getFilteredNotes', () => {
    beforeEach(() => {
      useNoteStore.setState({
        notes: [
          {
            id: '1',
            title: 'First Note',
            content: 'Hello world',
            createdAt: new Date('2024-01-01'),
            updatedAt: new Date('2024-01-03'),
            isPinned: false,
            tags: ['work'],
          },
          {
            id: '2',
            title: 'Second Note',
            content: 'Goodbye world',
            createdAt: new Date('2024-01-02'),
            updatedAt: new Date('2024-01-02'),
            isPinned: true,
            tags: ['personal'],
          },
          {
            id: '3',
            title: 'Third Note',
            content: 'Test content',
            createdAt: new Date('2024-01-03'),
            updatedAt: new Date('2024-01-01'),
            isPinned: false,
            tags: ['work', 'personal'],
          },
        ],
      });
    });

    it('should return all notes sorted by pinned first, then by updatedAt', () => {
      const filtered = useNoteStore.getState().getFilteredNotes();
      expect(filtered[0].id).toBe('2'); // pinned
      expect(filtered[1].id).toBe('1'); // most recently updated
      expect(filtered[2].id).toBe('3');
    });

    it('should filter by search query in title', () => {
      useNoteStore.setState({ searchQuery: 'first' });
      const filtered = useNoteStore.getState().getFilteredNotes();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('1');
    });

    it('should filter by search query in content', () => {
      useNoteStore.setState({ searchQuery: 'goodbye' });
      const filtered = useNoteStore.getState().getFilteredNotes();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('2');
    });

    it('should filter by tags', () => {
      useNoteStore.setState({ selectedTags: ['work'] });
      const filtered = useNoteStore.getState().getFilteredNotes();
      expect(filtered).toHaveLength(2);
    });

    it('should filter by multiple tags (intersection)', () => {
      useNoteStore.setState({ selectedTags: ['work', 'personal'] });
      const filtered = useNoteStore.getState().getFilteredNotes();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('3');
    });
  });

  describe('getAllTags', () => {
    it('should return sorted unique tags from all notes', () => {
      useNoteStore.setState({
        notes: [
          {
            id: '1',
            title: 'A',
            content: '',
            createdAt: new Date(),
            updatedAt: new Date(),
            isPinned: false,
            tags: ['work', 'urgent'],
          },
          {
            id: '2',
            title: 'B',
            content: '',
            createdAt: new Date(),
            updatedAt: new Date(),
            isPinned: false,
            tags: ['personal', 'work'],
          },
        ],
      });
      const tags = useNoteStore.getState().getAllTags();
      expect(tags).toEqual(['personal', 'urgent', 'work']);
    });

    it('should return empty array when no notes', () => {
      expect(useNoteStore.getState().getAllTags()).toEqual([]);
    });
  });
});
