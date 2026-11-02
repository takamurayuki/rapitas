/**
 * api-credentials
 *
 * Makes every request this app sends to its own backend carry the session
 * cookie, by wrapping `window.fetch` once.
 *
 * Why a wrapper rather than an edit per call site: the session lives in a
 * cookie on the backend's host, and `fetch` only sends cookies cross-origin
 * when the caller asks for `credentials: 'include'`. The frontend runs on port
 * 3000 and the API on 3001, so EVERY API request is cross-origin. `apiClient`
 * asks for credentials; `fetchWithRetry` and ~500 bare `fetch(`${API_BASE_URL}
 * ...`)` call sites across 216 files do not — so most requests arrived
 * anonymous, the request wrapper established no workspace, and workspace-scope
 * passed them through UNSCOPED. That is why a freshly registered account still
 * saw every task: it was never signing in as far as the data routes were
 * concerned.
 *
 * Patching 500 call sites would leave the 501st to reintroduce it. One
 * chokepoint cannot be forgotten, and `useErrorCapture` already establishes
 * that wrapping `window.fetch` is acceptable in this app.
 *
 * NOT responsible for the SameSite rule: a cookie set `SameSite=Strict` on
 * 127.0.0.1 is only sent from a 127.0.0.1 page, whatever this asks for. The
 * Tauri dev URL carries that half.
 */
import { API_BASE_URL } from '@/utils/api';

/** Set once the global wrapper is in place, so a remount cannot nest wrappers. */
let installed = false;

/**
 * The absolute form of a fetch input, or null when it cannot be determined.
 *
 * @param input - Whatever was passed to fetch / fetch に渡された値
 * @param origin - Base for a relative URL / 相対URLの基準
 * @returns An absolute URL string, or null / 絶対URL、判定不能ならnull
 */
function absoluteUrl(input: RequestInfo | URL, origin: string): string | null {
  const raw =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : typeof (input as Request)?.url === 'string'
          ? (input as Request).url
          : null;
  if (raw === null) return null;
  try {
    return new URL(raw, origin).href;
  } catch {
    return null;
  }
}

/**
 * Whether this request goes to our own backend and has not already decided
 * its credentials mode.
 *
 * A caller that passed `credentials` explicitly is left alone — including one
 * that deliberately passed `'omit'`.
 *
 * @param input - The fetch input / fetch の第1引数
 * @param init - The fetch init / fetch の第2引数
 * @param origin - The page origin / ページのオリジン
 * @param apiBase - The backend base URL / バックエンドのベースURL
 * @returns True when the wrapper should add credentials / 付与すべきならtrue
 */
export function shouldAttachCredentials(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  origin: string,
  apiBase: string,
): boolean {
  if (init?.credentials !== undefined) return false;
  const url = absoluteUrl(input, origin);
  if (url === null) return false;
  let base: string;
  try {
    base = new URL(apiBase, origin).origin;
  } catch {
    return false;
  }
  return new URL(url).origin === base;
}

/**
 * Wrap `window.fetch` so API requests send the session cookie. Idempotent, and
 * a no-op outside the browser.
 */
export function installApiCredentials(): void {
  if (installed || typeof window === 'undefined') return;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!shouldAttachCredentials(input, init, window.location.origin, API_BASE_URL)) {
      return original(input, init);
    }
    return original(input, { ...init, credentials: 'include' });
  };
  installed = true;
}

/** Test-only: forget that the wrapper was installed. */
export function resetApiCredentialsForTests(): void {
  installed = false;
}
