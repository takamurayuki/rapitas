import { renderHook, act } from '@testing-library/react';
import { useInAppShortcuts } from '../use-in-app-shortcuts';
import { useShortcutStore, DEFAULT_SHORTCUTS } from '@/stores/shortcut-store';

vi.mock('next-intl', () => {
  const t = (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key;
  return { useTranslations: () => t };
});

describe('useInAppShortcuts', () => {
  beforeEach(() => {
    useShortcutStore.setState({ shortcuts: DEFAULT_SHORTCUTS.map((s) => ({ ...s })) });
  });

  it('starts editing and saves a new binding', () => {
    const { result } = renderHook(() => useInAppShortcuts());

    act(() => {
      result.current.startEditing('newTask');
    });
    expect(result.current.editingId).toBe('newTask');
    expect(result.current.editBinding).toEqual({ key: 'N', meta: true, shift: false, ctrl: false });

    act(() => {
      result.current.handleSaveInApp();
    });

    expect(result.current.editingId).toBeNull();
    expect(result.current.inAppMessage).toEqual({ type: 'success', text: 'shortcutChanged' });
  });

  it('shows a duplicate error and blocks save when the recorded binding collides', () => {
    const { result } = renderHook(() => useInAppShortcuts());

    act(() => {
      result.current.startEditing('newTask');
      result.current.setIsRecordingInApp(true);
    });

    // dashboard's default binding is Ctrl/Cmd+D — record the same combination for newTask
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', ctrlKey: true }));
    });

    expect(result.current.duplicateWarning).toBe('duplicateWith:{"label":"dashboard"}');

    act(() => {
      result.current.handleSaveInApp();
    });

    expect(result.current.inAppMessage).toEqual({
      type: 'error',
      text: 'cannotSaveDuplicate:{"label":"dashboard"}',
    });
    expect(result.current.editingId).toBe('newTask');
  });

  it('resets all shortcuts to defaults', () => {
    const { result } = renderHook(() => useInAppShortcuts());

    useShortcutStore.getState().updateShortcut('newTask', { key: 'Z' });

    act(() => {
      result.current.handleResetAll();
    });

    const newTask = result.current.shortcuts.find((s) => s.id === 'newTask');
    expect(newTask?.key).toBe('N');
    expect(result.current.inAppMessage).toEqual({ type: 'success', text: 'resetAllDone' });
  });
});
