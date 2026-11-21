/**
 * chunk-reload.test
 *
 * 2026-11-21: after a deploy recycled the frontend dev server, an open page
 * showed 「エラーが発生しました」 with "Failed to load chunk
 * /_next/static/chunks/..._MarkdownView_tsx_....js" until the user reloaded
 * by hand. The chunk itself was being served again by then.
 */
import { describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadOnceForChunkError, CHUNK_RELOAD_GUARD_MS } from './chunk-reload';

const SEEN =
  'Failed to load chunk /_next/static/chunks/rapitas-frontend_src_components_markdown_MarkdownView_tsx_0ek4vmp3g9-6r._.js from module [project]/rapitas-frontend/src/components/markdown/MarkdownView.tsx [app-client] (ecmascript, next/dynamic entry, async loader)';

/** In-memory stand-in for sessionStorage. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

describe('isChunkLoadError', () => {
  it.each([
    SEEN,
    'Loading chunk 123 failed.',
    'Loading CSS chunk 9 failed',
    'Failed to fetch dynamically imported module: http://x/a.js',
  ])('recognises %s', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it('recognises a ChunkLoadError by name', () => {
    const err = new Error('whatever');
    err.name = 'ChunkLoadError';
    expect(isChunkLoadError(err)).toBe(true);
  });

  it('ignores other errors and non-errors', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError('Failed to load chunk x')).toBe(true);
  });
});

describe('reloadOnceForChunkError', () => {
  it('reloads on a chunk error', () => {
    const reload = vi.fn();
    expect(reloadOnceForChunkError(new Error(SEEN), { storage: memoryStorage(), reload })).toBe(
      true,
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload again right after a reload, so a real outage shows the error', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    reloadOnceForChunkError(new Error(SEEN), { storage, reload, now: () => 1_000 });
    expect(
      reloadOnceForChunkError(new Error(SEEN), { storage, reload, now: () => 1_000 + 5_000 }),
    ).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads again once the guard window has passed', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    reloadOnceForChunkError(new Error(SEEN), { storage, reload, now: () => 0 });
    reloadOnceForChunkError(new Error(SEEN), {
      storage,
      reload,
      now: () => CHUNK_RELOAD_GUARD_MS + 1,
    });
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('never reloads for other errors', () => {
    const reload = vi.fn();
    expect(reloadOnceForChunkError(new Error('boom'), { storage: memoryStorage(), reload })).toBe(
      false,
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when the guard cannot be recorded, so it can never loop', () => {
    const reload = vi.fn();
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    expect(reloadOnceForChunkError(new Error(SEEN), { storage: broken, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
