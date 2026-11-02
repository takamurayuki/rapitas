/**
 * useStaleDocumentReload.test
 *
 * Reloading the float window when the frontend it was loaded from is gone.
 *
 * This window is deliberately never destroyed — `close()` is intercepted and
 * turned into `hide()`, because recreating it whites out on this WebView2
 * build — and `focus_pomodoro_float` only does unminimize/show/set_focus. So
 * its document outlives every frontend restart, and the dev server reassigns
 * chunk URLs on each one. Measured 2026-10-22: `rapitas.exe` had been up since
 * 2026-10-19 12:45 while the frontend had restarted at 01:18 that morning, and
 * pressing 時間管理 showed a window with nothing in it.
 *
 * The backend restarts together with the frontend, so `/health`'s
 * `uptimeSeconds` dates the pair. These tests pin the three things that matter:
 * it reloads when that date moves, it does not reload when it has not, and
 * nothing it does can loop or throw into the render.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStaleDocumentReload, VISIBILITY_EVENT } from '../use-stale-document-reload';

const NOW = 1_700_000_000_000;

/** A /health response claiming the backend has been up this long. */
const health = (uptimeSeconds: number) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ uptimeSeconds }) } as Response);

let reload: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;
let listeners: Record<string, Array<(e: unknown) => void>>;

/** Fire the Tauri visibility event the Rust side emits on show. */
async function show(visible = true) {
  for (const fn of listeners[VISIBILITY_EVENT] ?? []) fn({ payload: visible });
  // The handler re-reads /health before deciding.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  listeners = {};
  reload = vi.fn();
  fetchMock = vi.fn(() => health(600));
  vi.stubGlobal('fetch', fetchMock);
  // The hook subscribes through the injected listener, so no Tauri is needed.
  vi.stubGlobal('location', { reload, href: 'http://localhost:3000/pomodoro-float' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Mount the hook with a stubbed event subscription. */
function mount() {
  return renderHook(() =>
    useStaleDocumentReload({
      subscribe: (event, handler) => {
        listeners[event] = [...(listeners[event] ?? []), handler as (e: unknown) => void];
        return () => {
          listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
        };
      },
    }),
  );
}

describe('useStaleDocumentReload', () => {
  it('reloads when the backend has restarted since this document loaded', async () => {
    // Loaded while the backend had been up 10 minutes; shown later with the
    // backend only 5 seconds old — the pair was replaced underneath us.
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    vi.setSystemTime(NOW + 60_000);
    fetchMock.mockImplementation(() => health(5));
    await show();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves a document alone when the backend is the same one', async () => {
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    vi.setSystemTime(NOW + 60_000);
    fetchMock.mockImplementation(() => health(660));
    await show();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads at most once, however many times the window is shown', async () => {
    // A reload that re-armed itself on a window whose fetch keeps answering
    // "new boot" would spin the webview forever.
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    fetchMock.mockImplementation(() => health(1));
    await show();
    await show();
    await show();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the window is being hidden', async () => {
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    fetchMock.mockImplementation(() => health(1));
    await show(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('stays quiet when it never learned a baseline', async () => {
    // The mount-time probe failed, so there is nothing to compare against and
    // reloading would be a guess.
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    fetchMock.mockImplementation(() => health(1));
    await show();
    expect(reload).not.toHaveBeenCalled();
  });

  it('stays quiet when the check itself fails', async () => {
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));
    await show();
    expect(reload).not.toHaveBeenCalled();
  });

  it('ignores a health body without a usable uptime', async () => {
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    fetchMock.mockImplementation(
      () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }) as Promise<Response>,
    );
    await show();
    expect(reload).not.toHaveBeenCalled();
  });

  it('tolerates a few seconds of jitter without reloading', async () => {
    // uptimeSeconds has one-second resolution and the two probes are taken at
    // different moments, so the estimate wobbles. Reloading on that would
    // bounce the window on every show.
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    vi.setSystemTime(NOW + 30_000);
    fetchMock.mockImplementation(() => health(628));
    await show();
    expect(reload).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = mount();
    await act(async () => {
      await Promise.resolve();
    });
    unmount();
    expect(listeners[VISIBILITY_EVENT] ?? []).toHaveLength(0);
  });
});
