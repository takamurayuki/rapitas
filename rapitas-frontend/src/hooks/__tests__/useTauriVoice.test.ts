import { renderHook, act, waitFor } from '@testing-library/react';
import { useTauriVoice } from '../common/useTauriVoice';

vi.mock('next-intl', () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});

/**
 * The hook dynamically `import()`s the real @tauri-apps/api/core module,
 * which is a thin wrapper forwarding every call to
 * `window.__TAURI_INTERNALS__.invoke(cmd, args, options)`. Mocking that
 * dynamic-import specifier proved unreliable across the hook's multiple call
 * sites (mount effect vs. later event-handler imports resolved to different
 * module instances in this test runner), so instead we stub the lower-level
 * `__TAURI_INTERNALS__.invoke` primitive that the real module always calls —
 * this is robust regardless of which copy of the wrapper module is loaded.
 */
const mockInvoke = vi.fn();

describe('useTauriVoice', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  afterEach(() => {
    // @ts-expect-error test cleanup of injected Tauri marker
    delete window.__TAURI_INTERNALS__;
  });

  function enableTauri() {
    // @ts-expect-error injecting a minimal Tauri internals stub for the test
    window.__TAURI_INTERNALS__ = { invoke: mockInvoke };
  }

  it('reports isSupported false outside Tauri', () => {
    const { result } = renderHook(() => useTauriVoice());
    expect(result.current.isSupported).toBe(false);
  });

  it('startListening is a no-op outside Tauri', async () => {
    const { result } = renderHook(() => useTauriVoice());
    await act(async () => {
      result.current.startListening();
    });
    expect(result.current.isListening).toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('reports isSupported true and checks model status inside Tauri', async () => {
    enableTauri();
    mockInvoke.mockResolvedValue({ downloaded: true, recording: false });

    const { result } = renderHook(() => useTauriVoice());
    expect(result.current.isSupported).toBe(true);

    await waitFor(() => expect(result.current.modelDownloaded).toBe(true));
    expect(mockInvoke).toHaveBeenCalledWith('voice_model_status', {}, undefined);
  });

  it('startListening transcribes and calls onResult with the text', async () => {
    enableTauri();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'voice_model_status')
        return Promise.resolve({ downloaded: true, recording: false });
      if (cmd === 'voice_start_recording') return Promise.resolve('hello world');
      return Promise.resolve(undefined);
    });
    const onResult = vi.fn();

    const { result } = renderHook(() => useTauriVoice(onResult));
    await act(async () => {
      await result.current.startListening();
    });

    expect(result.current.transcript).toBe('hello world');
    expect(result.current.isListening).toBe(false);
    expect(onResult).toHaveBeenCalledWith('hello world');
  });

  it('startListening sets an error when transcription is empty', async () => {
    enableTauri();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'voice_model_status')
        return Promise.resolve({ downloaded: true, recording: false });
      if (cmd === 'voice_start_recording') return Promise.resolve('   ');
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useTauriVoice());
    await act(async () => {
      await result.current.startListening();
    });

    expect(result.current.error).toBe('useTauriVoice.recognitionFailed');
  });

  it('startListening sets an error message when invoke rejects', async () => {
    enableTauri();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'voice_model_status')
        return Promise.resolve({ downloaded: false, recording: false });
      if (cmd === 'voice_start_recording') return Promise.reject(new Error('mic denied'));
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useTauriVoice());
    await act(async () => {
      await result.current.startListening();
    });

    expect(result.current.error).toBe('mic denied');
    expect(result.current.isListening).toBe(false);
  });

  it('stopListening invokes voice_stop_recording', async () => {
    enableTauri();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'voice_model_status')
        return Promise.resolve({ downloaded: true, recording: false });
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useTauriVoice());
    await act(async () => {
      await result.current.stopListening();
    });

    expect(mockInvoke).toHaveBeenCalledWith('voice_stop_recording', {}, undefined);
  });

  it('resetTranscript clears transcript and error', async () => {
    enableTauri();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'voice_model_status')
        return Promise.resolve({ downloaded: true, recording: false });
      if (cmd === 'voice_start_recording') return Promise.resolve('text');
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useTauriVoice());
    await act(async () => {
      await result.current.startListening();
    });
    expect(result.current.transcript).toBe('text');

    act(() => {
      result.current.resetTranscript();
    });

    expect(result.current.transcript).toBe('');
    expect(result.current.error).toBeNull();
  });
});
