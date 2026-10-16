import { renderHook, act, waitFor } from '@testing-library/react';
import { useShortcutSlot, type ShortcutSlotConfig } from '../use-shortcut-slot';

vi.mock('next-intl', () => {
  // NOTE: The stub must be referentially stable — a fresh function per render
  // would loop useShortcutSlot's mount effect forever.
  const t = (key: string) => key;
  return { useTranslations: () => t };
});

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), debug: vi.fn() }),
}));

const mockInvoke = vi.fn();

/**
 * The hook dynamically `import()`s `@tauri-apps/api/core`, which forwards
 * every call to `window.__TAURI_INTERNALS__.invoke`. Stubbing that lower-level
 * primitive (matching the pattern used by useTauriVoice.test.ts) is robust
 * regardless of which copy of the wrapper module is loaded.
 */
function enableTauri() {
  // @ts-expect-error injecting a minimal Tauri internals stub for the test
  window.__TAURI_INTERNALS__ = { invoke: mockInvoke };
}

function disableTauri() {
  // @ts-expect-error test cleanup of injected Tauri marker
  delete window.__TAURI_INTERNALS__;
}

const CAPTURE_CONFIG: ShortcutSlotConfig = {
  getCommand: 'get_capture_shortcut',
  setCommand: 'set_capture_shortcut',
  localStorageKey: 'captureShortcut',
  defaultShortcut: 'Ctrl+Alt+I',
  isTauriEnv: true,
};

const GLOBAL_CONFIG: ShortcutSlotConfig = {
  getCommand: 'get_global_shortcut',
  setCommand: 'set_global_shortcut',
  localStorageKey: 'globalShortcut',
  defaultShortcut: 'Ctrl+Alt+R',
  isTauriEnv: true,
};

describe('useShortcutSlot', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    disableTauri();
  });

  it('loads the persisted shortcut in a Tauri environment', async () => {
    enableTauri();
    mockInvoke.mockResolvedValue('Ctrl+Shift+I');

    const { result } = renderHook(() => useShortcutSlot(CAPTURE_CONFIG));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.currentShortcut).toBe('Ctrl+Shift+I');
    expect(result.current.modifiers).toEqual(['Ctrl', 'Shift']);
    expect(result.current.key).toBe('I');
    expect(mockInvoke).toHaveBeenCalledWith('get_capture_shortcut', {}, undefined);
  });

  it('falls back to the default when the Tauri load call fails', async () => {
    enableTauri();
    mockInvoke.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useShortcutSlot(CAPTURE_CONFIG));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.currentShortcut).toBe('Ctrl+Alt+I');
  });

  it('falls back to localStorage in a non-Tauri (web) environment', async () => {
    disableTauri();
    localStorage.setItem('captureShortcut', 'Ctrl+Shift+K');

    const { result } = renderHook(() => useShortcutSlot({ ...CAPTURE_CONFIG, isTauriEnv: false }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.currentShortcut).toBe('Ctrl+Shift+K');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('rejects saving with zero modifiers', async () => {
    enableTauri();
    mockInvoke.mockResolvedValue('Ctrl+Alt+I');

    const { result } = renderHook(() => useShortcutSlot(CAPTURE_CONFIG));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.toggleModifier('Ctrl');
      result.current.toggleModifier('Alt');
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.message).toEqual({ type: 'error', text: 'selectModifiers' });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('saves via the configured set command with the built shortcut string', async () => {
    enableTauri();
    mockInvoke.mockResolvedValueOnce('Ctrl+Alt+I').mockResolvedValueOnce('Ctrl+Alt+K');

    const { result } = renderHook(() => useShortcutSlot(CAPTURE_CONFIG));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setKey('K');
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockInvoke).toHaveBeenLastCalledWith(
      'set_capture_shortcut',
      { shortcut: 'Ctrl+Alt+K' },
      undefined,
    );
    expect(result.current.currentShortcut).toBe('Ctrl+Alt+K');
    expect(result.current.message?.type).toBe('success');
  });

  it('keeps two slot instances independent', async () => {
    enableTauri();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_global_shortcut') return 'Ctrl+Alt+R';
      if (cmd === 'get_capture_shortcut') return 'Ctrl+Alt+I';
      return '';
    });

    const { result: globalResult } = renderHook(() => useShortcutSlot(GLOBAL_CONFIG));
    const { result: captureResult } = renderHook(() => useShortcutSlot(CAPTURE_CONFIG));

    await waitFor(() => expect(globalResult.current.isLoading).toBe(false));
    await waitFor(() => expect(captureResult.current.isLoading).toBe(false));

    act(() => {
      globalResult.current.setKey('T');
    });

    expect(globalResult.current.key).toBe('T');
    expect(captureResult.current.key).toBe('I');
  });

  it('calls the load command exactly once on mount (no reload loop)', async () => {
    enableTauri();
    mockInvoke.mockResolvedValue('Ctrl+Alt+I');

    const { result } = renderHook(() => useShortcutSlot(CAPTURE_CONFIG));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});
