/**
 * ApiHeaders
 *
 * Hosts the X-Rapitas-Source header constants and the header-merge helper
 * shared by the frontend fetch layers (fetchWithRetry, api-client).
 * Not responsible for issuing requests or deciding restart policy.
 *
 * NOTE: This module must stay dependency-free — both `utils/api.ts` and
 * `lib/api-client/client.ts` import from here, and any import added here can
 * reintroduce the circular reference this module exists to avoid.
 */

/**
 * Header name marking a request as UI-originated.
 * NOTE: Must match rapitas-backend ui-activity-tracker.ts (lowercase — Fetch
 * API header lookups are case-insensitive, but tests assert string equality).
 */
export const UI_SOURCE_HEADER = 'x-rapitas-source';

/** Header value marking a request as user-originated from the UI. */
export const UI_SOURCE_VALUE = 'ui';

/**
 * Header value for reads that no user action caused (polling, background
 * refresh). The backend does not count it as activity, so an open window no
 * longer holds the restart gate forever (task 1548).
 * NOTE: Must match UI_POLL_SOURCE_VALUE in rapitas-backend ui-activity-tracker.ts.
 */
export const UI_POLL_SOURCE_VALUE = 'ui-poll';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** How the caller says where a request came from. */
export interface UiSourceOptions {
  /** True when a user operation (search, opening a detail) issued this read. / 利用者の操作由来の取得 */
  userAction?: boolean;
}

/**
 * Pick the X-Rapitas-Source value for a request.
 *
 * Mutations are always `ui`: eight human-confirmation routes accept only `ui`
 * (or `operator`), so a mutation must never be downgraded. A read is `ui`
 * only when its caller says a user operation issued it; every other read is
 * `ui-poll`.
 *
 * NOTE: No timing is involved (task 1548). A "5 s after a click or key press"
 * window used to tag reads `ui`, so a poll that fired just after any click was
 * counted as activity and every interaction reopened the restart defer window.
 *
 * @param method - HTTP method; undefined is treated as GET / HTTPメソッド（未指定はGET）
 * @param opts - Where the request came from / リクエストの発生元
 * @returns `ui` or `ui-poll` / ヘッダー値
 */
export function resolveUiSourceValue(method?: string, opts: UiSourceOptions = {}): string {
  if (MUTATION_METHODS.has((method || 'GET').toUpperCase())) return UI_SOURCE_VALUE;
  return opts.userAction === true ? UI_SOURCE_VALUE : UI_POLL_SOURCE_VALUE;
}

/**
 * Build a Headers object from a RequestInit, tagged with the UI source header.
 *
 * Normalizes all three `HeadersInit` shapes (plain object / Headers instance /
 * `[key, value][]` array) via the `Headers` constructor — a naive object
 * spread would silently drop the latter two. A caller-provided
 * `x-rapitas-source` value is preserved (caller-wins, matching the
 * api-client header-merge convention).
 *
 * NOTE: With no known method the value stays `ui`. Most direct callers pass
 * only `{ headers }` here and set `method: 'POST'` on the outer fetch init
 * (e.g. approve-plan), so "no method" does NOT mean GET at this layer, and
 * downgrading it would make human-confirmation routes answer 403.
 *
 * @param init - The RequestInit whose headers to merge / ヘッダを取り込む元のRequestInit
 * @param method - Actual HTTP method when known (else init.method) / 実際のHTTPメソッド
 * @returns Headers with the UI source header set / UIソースヘッダ付きのHeaders
 */
export function mergeUiSourceHeaders(init?: RequestInit, method?: string): Headers {
  const headers = new Headers(init?.headers);
  if (!headers.has(UI_SOURCE_HEADER)) {
    const known = method ?? init?.method;
    headers.set(UI_SOURCE_HEADER, known ? resolveUiSourceValue(known) : UI_SOURCE_VALUE);
  }
  return headers;
}
