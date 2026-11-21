/**
 * chunk-reload
 *
 * Recovers a page whose code-split chunk no longer exists by reloading it once.
 * Not responsible for showing the error; callers keep their error UI for the
 * case where the reload is withheld.
 *
 * NOTE: A deploy recycles the frontend dev server and clears `.next`, so a page
 * left open asks for a chunk name that is gone and shows 「エラーが発生しました」
 * ("Failed to load chunk ...MarkdownView_tsx..." on 2026-11-21). A fresh load
 * fetches the new chunk names.
 */

/** A second reload within this window is withheld, so a real outage shows its error. */
export const CHUNK_RELOAD_GUARD_MS = 60_000;

const GUARD_KEY = 'rapitas:chunk-reload-at';

/** Messages webpack, Turbopack and native dynamic import use for a missing chunk. */
const CHUNK_ERROR_RE =
  /Failed to load chunk|Loading (?:CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i;

/**
 * Whether an error means a code-split chunk could not be loaded.
 *
 * @param error - Anything thrown or rejected / 投げられた値
 * @returns True for a chunk-load failure / チャンク読み込み失敗なら true
 */
export function isChunkLoadError(error: unknown): boolean {
  if (typeof error === 'string') return CHUNK_ERROR_RE.test(error);
  if (!(error instanceof Error)) return false;
  return error.name === 'ChunkLoadError' || CHUNK_ERROR_RE.test(error.message);
}

/** Injectable pieces of {@link reloadOnceForChunkError}. */
export interface ChunkReloadDeps {
  storage?: Storage;
  reload?: () => void;
  now?: () => number;
}

/**
 * Reload the page once for a chunk-load failure.
 *
 * @param error - The caught error / 捕捉したエラー
 * @param deps - Storage, reload and clock, injectable for tests / テスト用の注入
 * @returns True when a reload was started / 再読み込みを始めたら true
 */
export function reloadOnceForChunkError(error: unknown, deps: ChunkReloadDeps = {}): boolean {
  if (!isChunkLoadError(error)) return false;
  const now = (deps.now ?? Date.now)();
  const storage =
    deps.storage ?? (typeof window !== 'undefined' ? window.sessionStorage : undefined);
  const reload = deps.reload ?? (() => window.location.reload());
  try {
    if (!storage) return false;
    const last = Number(storage.getItem(GUARD_KEY) ?? 0);
    if (last && now - last < CHUNK_RELOAD_GUARD_MS) return false;
    storage.setItem(GUARD_KEY, String(now));
  } catch {
    // Without a recorded guard a persistent failure would reload forever, so
    // the error UI is shown instead (the user can still reload by hand).
    return false;
  }
  reload();
  return true;
}
