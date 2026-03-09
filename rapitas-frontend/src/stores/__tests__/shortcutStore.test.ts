import {
  useShortcutStore,
  DEFAULT_SHORTCUTS,
  formatBindingKey,
} from '../shortcutStore';

describe('shortcutStore', () => {
  beforeEach(() => {
    useShortcutStore.setState({
      shortcuts: DEFAULT_SHORTCUTS.map((s) => ({ ...s })),
    });
  });

  it('should have default shortcuts as initial state', () => {
    const shortcuts = useShortcutStore.getState().shortcuts;
    expect(shortcuts).toHaveLength(DEFAULT_SHORTCUTS.length);
    expect(shortcuts[0].id).toBe('newTask');
  });

  describe('updateShortcut', () => {
    it('should update a shortcut key', () => {
      useShortcutStore.getState().updateShortcut('newTask', { key: 'M' });
      const updated = useShortcutStore
        .getState()
        .shortcuts.find((s) => s.id === 'newTask');
      expect(updated?.key).toBe('M');
    });

    it('should not modify other shortcuts', () => {
      useShortcutStore.getState().updateShortcut('newTask', { key: 'M' });
      const dashboard = useShortcutStore
        .getState()
        .shortcuts.find((s) => s.id === 'dashboard');
      expect(dashboard?.key).toBe('D');
    });

    it('should update multiple properties at once', () => {
      useShortcutStore.getState().updateShortcut('newTask', {
        key: 'X',
        shift: true,
        meta: false,
        ctrl: true,
      });
      const updated = useShortcutStore
        .getState()
        .shortcuts.find((s) => s.id === 'newTask');
      expect(updated?.key).toBe('X');
      expect(updated?.shift).toBe(true);
      expect(updated?.meta).toBe(false);
      expect(updated?.ctrl).toBe(true);
    });
  });

  describe('resetShortcut', () => {
    it('should reset a single shortcut to default', () => {
      useShortcutStore.getState().updateShortcut('newTask', { key: 'Z' });
      useShortcutStore.getState().resetShortcut('newTask');
      const reset = useShortcutStore
        .getState()
        .shortcuts.find((s) => s.id === 'newTask');
      expect(reset?.key).toBe('N');
    });

    it('should not change state if id does not exist', () => {
      const before = useShortcutStore.getState().shortcuts;
      useShortcutStore.getState().resetShortcut('nonExistent' as never);
      const after = useShortcutStore.getState().shortcuts;
      expect(before).toBe(after);
    });
  });

  describe('resetAll', () => {
    it('should reset all shortcuts to defaults', () => {
      useShortcutStore.getState().updateShortcut('newTask', { key: 'Z' });
      useShortcutStore.getState().updateShortcut('dashboard', { key: 'X' });
      useShortcutStore.getState().resetAll();
      const shortcuts = useShortcutStore.getState().shortcuts;
      const newTask = shortcuts.find((s) => s.id === 'newTask');
      const dashboard = shortcuts.find((s) => s.id === 'dashboard');
      expect(newTask?.key).toBe('N');
      expect(dashboard?.key).toBe('D');
    });
  });

  describe('getDefault', () => {
    it('should return the default binding for a given id', () => {
      const def = useShortcutStore.getState().getDefault('newTask');
      expect(def).toBeDefined();
      expect(def?.key).toBe('N');
      expect(def?.meta).toBe(true);
    });

    it('should return undefined for non-existent id', () => {
      const def = useShortcutStore
        .getState()
        .getDefault('nonExistent' as never);
      expect(def).toBeUndefined();
    });
  });

  describe('findDuplicate', () => {
    it('should return undefined when no duplicate exists', () => {
      const dup = useShortcutStore.getState().findDuplicate('newTask', {
        key: 'Q',
        meta: true,
        shift: false,
        ctrl: false,
      });
      expect(dup).toBeUndefined();
    });

    it('should find a duplicate binding from another shortcut', () => {
      // dashboard has key 'D', meta: true, shift: false, ctrl: false
      const dup = useShortcutStore.getState().findDuplicate('newTask', {
        key: 'D',
        meta: true,
        shift: false,
        ctrl: false,
      });
      expect(dup).toBeDefined();
      expect(dup?.id).toBe('dashboard');
    });

    it('should not flag self as duplicate', () => {
      const dup = useShortcutStore.getState().findDuplicate('newTask', {
        key: 'N',
        meta: true,
        shift: false,
        ctrl: false,
      });
      expect(dup).toBeUndefined();
    });
  });

  describe('formatBindingKey', () => {
    it('should format a meta+key binding', () => {
      expect(
        formatBindingKey({ key: 'N', meta: true, shift: false, ctrl: false }),
      ).toBe('meta+N');
    });

    it('should format a ctrl+shift+key binding', () => {
      expect(
        formatBindingKey({ key: 'F', meta: false, shift: true, ctrl: true }),
      ).toBe('ctrl+shift+F');
    });

    it('should format a key-only binding', () => {
      expect(
        formatBindingKey({ key: 'a', meta: false, shift: false, ctrl: false }),
      ).toBe('A');
    });
  });
});
