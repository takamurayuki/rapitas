/**
 * pomodoro-sync tests
 *
 * All methods are fire-and-forget fetch chains (no returned promise), so
 * tests flush microtasks with `flushPromises()` before asserting on the
 * mocked `fetch` calls.
 */
vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

// Hoisted once for the whole file — dynamic import() caches the module after
// its first resolution, so re-mocking with vi.doMock between individual
// tests silently no-ops on the second+ call. A single shared mock avoids that.
vi.mock('@tauri-apps/api/event', () => ({ emitTo: vi.fn().mockResolvedValue(undefined) }));

import { emitTo } from '@tauri-apps/api/event';
import { syncPomodoroToBackend } from '../pomodoro-sync';

const emitToMock = vi.mocked(emitTo);

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Stubs window.location.pathname for the isSyncOwner path-exclusion checks. */
function setPathname(pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname },
    writable: true,
    configurable: true,
  });
}

describe('syncPomodoroToBackend', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setPathname('/');
  });

  describe('start', () => {
    it('posts taskId, duration, and default type "work"', async () => {
      const fetchMock = vi.fn().mockResolvedValue({});
      vi.stubGlobal('fetch', fetchMock);

      syncPomodoroToBackend.start(7, 1500);
      await flushPromises();

      expect(fetchMock).toHaveBeenCalledWith('http://test:3001/pomodoro/start', {
        signal: expect.anything(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: 7, duration: 1500, type: 'work' }),
      });
    });

    it('posts the given session type when provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue({});
      vi.stubGlobal('fetch', fetchMock);

      syncPomodoroToBackend.start(null, 300, 'short_break');
      await flushPromises();

      expect(fetchMock).toHaveBeenCalledWith('http://test:3001/pomodoro/start', {
        signal: expect.anything(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: null, duration: 300, type: 'short_break' }),
      });
    });

    it('swallows fetch rejection without throwing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
      expect(() => syncPomodoroToBackend.start(1, 100)).not.toThrow();
      await flushPromises();
    });
  });

  describe('complete', () => {
    it('completes the active session when one exists', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ json: () => Promise.resolve({ session: { id: 42 } }) })
        .mockResolvedValueOnce({});
      vi.stubGlobal('fetch', fetchMock);

      syncPomodoroToBackend.complete(3);
      await flushPromises();
      await flushPromises();

      expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://test:3001/pomodoro/active', {
        signal: expect.anything(),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'http://test:3001/pomodoro/sessions/42/complete',
        { signal: expect.anything(), method: 'POST' },
      );
    });

    it('does not call the complete endpoint when no active session exists', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({ json: () => Promise.resolve({}) });
      vi.stubGlobal('fetch', fetchMock);

      syncPomodoroToBackend.complete(1);
      await flushPromises();
      await flushPromises();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('swallows fetch rejection without throwing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
      expect(() => syncPomodoroToBackend.complete(1)).not.toThrow();
      await flushPromises();
    });
  });

  describe('cancel', () => {
    it('cancels the active session when one exists', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ json: () => Promise.resolve({ session: { id: 9 } }) })
        .mockResolvedValueOnce({});
      vi.stubGlobal('fetch', fetchMock);

      syncPomodoroToBackend.cancel();
      await flushPromises();
      await flushPromises();

      expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://test:3001/pomodoro/active', {
        signal: expect.anything(),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://test:3001/pomodoro/sessions/9/cancel', {
        signal: expect.anything(),
        method: 'POST',
      });
    });

    it('does not call the cancel endpoint when no active session exists', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({ json: () => Promise.resolve({}) });
      vi.stubGlobal('fetch', fetchMock);

      syncPomodoroToBackend.cancel();
      await flushPromises();
      await flushPromises();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('swallows fetch rejection without throwing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
      expect(() => syncPomodoroToBackend.cancel()).not.toThrow();
      await flushPromises();
    });
  });

  describe('isSyncOwner via pathname exclusion', () => {
    it.each(['/pomodoro-float', '/quick-capture'])(
      'does not call fetch for start/complete/cancel on %s',
      async (pathname) => {
        setPathname(pathname);
        const fetchMock = vi.fn().mockResolvedValue({});
        vi.stubGlobal('fetch', fetchMock);

        syncPomodoroToBackend.start(1, 1500);
        syncPomodoroToBackend.complete(1);
        syncPomodoroToBackend.cancel();
        await flushPromises();

        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('calls fetch for start on the main window path "/"', async () => {
      setPathname('/');
      const fetchMock = vi.fn().mockResolvedValue({});
      vi.stubGlobal('fetch', fetchMock);

      syncPomodoroToBackend.start(1, 1500);
      await flushPromises();

      expect(fetchMock).toHaveBeenCalledWith('http://test:3001/pomodoro/start', expect.anything());
    });
  });

  describe('float window delegation', () => {
    /** Stubs `'__TAURI_INTERNALS__' in window` for the isFloatWindow() check. */
    function setTauriInternals(present: boolean): void {
      if (present) {
        (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
      } else {
        delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
      }
    }

    afterEach(() => {
      setTauriInternals(false);
    });

    beforeEach(() => {
      emitToMock.mockClear();
      emitToMock.mockResolvedValue(undefined);
    });

    it('cancel() emits pomodoro-float:cancel-request to main instead of fetching, under Tauri on /pomodoro-float', async () => {
      setPathname('/pomodoro-float');
      setTauriInternals(true);
      const fetchMock = vi.fn().mockResolvedValue({});
      vi.stubGlobal('fetch', fetchMock);

      syncPomodoroToBackend.cancel();
      await flushPromises();
      await flushPromises();

      expect(emitToMock).toHaveBeenCalledWith('main', 'pomodoro-float:cancel-request');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('checkpoint() emits pomodoro-float:checkpoint-request to main instead of fetching, under Tauri on /pomodoro-float', async () => {
      setPathname('/pomodoro-float');
      setTauriInternals(true);
      const fetchMock = vi.fn().mockResolvedValue({});
      vi.stubGlobal('fetch', fetchMock);

      const result = await syncPomodoroToBackend.checkpoint();
      await flushPromises();
      await flushPromises();

      expect(emitToMock).toHaveBeenCalledWith('main', 'pomodoro-float:checkpoint-request');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('cancel() does not delegate on /pomodoro-float without __TAURI_INTERNALS__ (existing jsdom/browser test env)', async () => {
      setPathname('/pomodoro-float');
      setTauriInternals(false);
      const fetchMock = vi.fn().mockResolvedValue({});
      vi.stubGlobal('fetch', fetchMock);

      syncPomodoroToBackend.cancel();
      await flushPromises();

      expect(emitToMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
