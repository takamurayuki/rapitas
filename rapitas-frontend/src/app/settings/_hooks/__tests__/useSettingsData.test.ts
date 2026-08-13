/**
 * useSettingsData.test
 *
 * Verifies every fetch issued by useSettingsData (mount GETs via fetchWithSWR,
 * mutation handlers, and the download-progress polling GET) carries the UI
 * source header (x-rapitas-source: ui) and preserves Content-Type headers.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSettingsData } from '../useSettingsData';
import type { UserSettings } from '@/types';

vi.mock('next-intl', () => {
  // NOTE: The stub must be referentially stable — the hook's useCallback deps
  // include `t`, and a fresh function per render loops the mount effect forever.
  const t = (key: string) => key;
  return { useTranslations: () => t };
});

vi.mock('@/components/ui/dialog/ConfirmDialogProvider', () => ({
  useConfirmDialog: () => () => Promise.resolve(true),
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), debug: vi.fn() }),
}));

const { getCachedDataMock } = vi.hoisted(() => ({
  getCachedDataMock: vi.fn(),
}));

vi.mock('../settings-cache', () => ({
  CACHE_KEYS: {
    settings: 'settings-cache',
    models: 'models-cache',
    apiKeys: 'api-keys-cache',
  },
  getCachedData: getCachedDataMock,
  setCachedData: vi.fn(),
}));

type FetchCall = [RequestInfo | URL, RequestInit | undefined];

/** Extracts a header value from a recorded fetch call, normalizing HeadersInit. */
const headerOf = (call: FetchCall, name: string): string | null =>
  new Headers(call[1]?.headers).get(name);

/** Finds all recorded fetch calls whose URL contains the given fragment. */
const callsFor = (fetchMock: ReturnType<typeof vi.fn>, urlPart: string): FetchCall[] =>
  (fetchMock.mock.calls as FetchCall[]).filter((c) => String(c[0]).includes(urlPart));

describe('useSettingsData UI source header coverage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getCachedDataMock.mockReturnValue(null);
    fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      const json = u.includes('download-progress')
        ? { status: 'completed', progress: 100, downloadedMB: 1, totalMB: 1 }
        : u.includes('test-connection')
          ? { success: true }
          : u.includes('api-key') && !u.includes('api-keys')
            ? { maskedKey: 'sk-***' }
            : {};
      return {
        ok: true,
        json: () => Promise.resolve(json),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const mount = async () => {
    const rendered = renderHook(() => useSettingsData());
    // Mount GETs (settings / api-keys / models / local-llm status) all fire on effect.
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4));
    return rendered;
  };

  it('tags all mount GETs (settings/api-keys/models/local-llm status) with the UI header', async () => {
    await mount();

    for (const urlPart of ['/settings', '/settings/api-keys', '/settings/models', '/local-llm/status']) {
      const calls = callsFor(fetchMock, urlPart);
      expect(calls.length, `expected a fetch for ${urlPart}`).toBeGreaterThanOrEqual(1);
      for (const call of calls) {
        expect(headerOf(call, 'x-rapitas-source'), `UI header on ${String(call[0])}`).toBe('ui');
      }
    }
  });

  it('tags the background-revalidate GET (cached settings path) with the UI header', async () => {
    // NOTE: A cache hit for the settings key routes the request through the
    // background-revalidate fetch inside fetchWithSWR instead of the foreground one.
    getCachedDataMock.mockImplementation((key: string) =>
      key === 'settings-cache' ? { ollamaUrl: '' } : null,
    );

    await mount();

    const settingsGets = callsFor(fetchMock, '/settings').filter((c) => !c[1]?.method);
    expect(settingsGets.length).toBeGreaterThanOrEqual(1);
    for (const call of settingsGets) {
      expect(headerOf(call, 'x-rapitas-source')).toBe('ui');
    }
  });

  it('saveApiKey sends POST /settings/api-key with UI header and preserved Content-Type', async () => {
    const { result } = await mount();

    act(() => {
      result.current.updateProviderState('claude', { apiKeyInput: 'test-key' });
    });
    fetchMock.mockClear();

    await act(async () => {
      await result.current.saveApiKey('claude', 'claudeApiKeyConfigured' as keyof UserSettings);
    });

    const [call] = callsFor(fetchMock, '/settings/api-key');
    expect(call[1]?.method).toBe('POST');
    expect(headerOf(call, 'x-rapitas-source')).toBe('ui');
    expect(headerOf(call, 'content-type')).toBe('application/json');
  });

  it('deleteApiKey (confirm accepted) sends DELETE with UI header', async () => {
    const { result } = await mount();
    fetchMock.mockClear();

    await act(async () => {
      await result.current.deleteApiKey('claude', 'claudeApiKeyConfigured' as keyof UserSettings);
    });

    const [call] = callsFor(fetchMock, '/settings/api-key?provider=claude');
    expect(call[1]?.method).toBe('DELETE');
    expect(headerOf(call, 'x-rapitas-source')).toBe('ui');
  });

  it('saveModel sends POST /settings/model with UI header and preserved Content-Type', async () => {
    const { result } = await mount();
    fetchMock.mockClear();

    await act(async () => {
      await result.current.saveModel('claude', 'claudeModel' as keyof UserSettings, 'claude-fable-5');
    });

    const [call] = callsFor(fetchMock, '/settings/model');
    expect(call[1]?.method).toBe('POST');
    expect(headerOf(call, 'x-rapitas-source')).toBe('ui');
    expect(headerOf(call, 'content-type')).toBe('application/json');
  });

  it('saveDefaultProvider sends PATCH /settings with UI header and preserved Content-Type', async () => {
    const { result } = await mount();
    fetchMock.mockClear();

    await act(async () => {
      await result.current.saveDefaultProvider('claude');
    });

    const [call] = callsFor(fetchMock, '/settings');
    expect(call[1]?.method).toBe('PATCH');
    expect(headerOf(call, 'x-rapitas-source')).toBe('ui');
    expect(headerOf(call, 'content-type')).toBe('application/json');
  });

  it('saveLocalLlmSettings sends PATCH /settings with UI header and preserved Content-Type', async () => {
    const { result } = await mount();
    fetchMock.mockClear();

    await act(async () => {
      await result.current.saveLocalLlmSettings({ localLlmEnabled: true });
    });

    const [call] = callsFor(fetchMock, '/settings');
    expect(call[1]?.method).toBe('PATCH');
    expect(headerOf(call, 'x-rapitas-source')).toBe('ui');
    expect(headerOf(call, 'content-type')).toBe('application/json');
  });

  it('handleTestConnection sends POST /local-llm/test-connection with UI header and Content-Type', async () => {
    const { result } = await mount();
    fetchMock.mockClear();

    await act(async () => {
      await result.current.handleTestConnection();
    });

    const [call] = callsFor(fetchMock, '/local-llm/test-connection');
    expect(call[1]?.method).toBe('POST');
    expect(headerOf(call, 'x-rapitas-source')).toBe('ui');
    expect(headerOf(call, 'content-type')).toBe('application/json');
  });

  it('handleDownloadModel tags both the POST and the polling progress GET with the UI header', async () => {
    const { result } = await mount();
    fetchMock.mockClear();
    vi.useFakeTimers();

    try {
      await act(async () => {
        await result.current.handleDownloadModel();
      });

      const [postCall] = callsFor(fetchMock, '/local-llm/download-model');
      expect(postCall[1]?.method).toBe('POST');
      expect(headerOf(postCall, 'x-rapitas-source')).toBe('ui');

      // Fire the 1s polling interval once; the mocked completed status stops it.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      const [pollCall] = callsFor(fetchMock, '/local-llm/download-progress');
      expect(pollCall, 'polling GET should have fired').toBeDefined();
      expect(headerOf(pollCall, 'x-rapitas-source')).toBe('ui');
    } finally {
      vi.useRealTimers();
    }
  });
});
