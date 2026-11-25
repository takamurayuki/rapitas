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

/** A read this soon after a click or key press is treated as caused by it (navigation). */
export const USER_INTERACTION_WINDOW_MS = 5_000;

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
let lastUserInteractionAt = Number.NEGATIVE_INFINITY;
let listenerInstalled = false;

/**
 * Record that the user just clicked or pressed a key.
 *
 * @param now - Epoch ms of the interaction / 操作の時刻（エポックms）
 */
export function noteUserInteraction(now: number = Date.now()): void {
  lastUserInteractionAt = now;
}

/**
 * Pick the X-Rapitas-Source value for a request.
 *
 * Mutations are always `ui`: eight human-confirmation routes accept only `ui`
 * (or `operator`), so a mutation must never be downgraded. Reads are `ui`
 * only within USER_INTERACTION_WINDOW_MS of a click/key press, else `ui-poll`.
 *
 * @param method - HTTP method; undefined is treated as GET / HTTPメソッド（未指定はGET）
 * @param now - Current epoch ms / 現在時刻（エポックms）
 * @returns `ui` or `ui-poll` / ヘッダー値
 */
export function resolveUiSourceValue(method?: string, now: number = Date.now()): string {
  if (MUTATION_METHODS.has((method || 'GET').toUpperCase())) return UI_SOURCE_VALUE;
  return now - lastUserInteractionAt <= USER_INTERACTION_WINDOW_MS
    ? UI_SOURCE_VALUE
    : UI_POLL_SOURCE_VALUE;
}

/**
 * Start recording clicks and key presses (capture phase). Idempotent.
 *
 * @param target - Event target to listen on / 監視対象
 */
export function installUserInteractionListener(target: EventTarget = window): void {
  if (listenerInstalled) return;
  listenerInstalled = true;
  const note = () => noteUserInteraction();
  target.addEventListener('pointerdown', note, { capture: true, passive: true });
  target.addEventListener('keydown', note, { capture: true, passive: true });
}

/** Forget the last interaction (tests only). */
export function resetUserInteractionForTests(): void {
  lastUserInteractionAt = Number.NEGATIVE_INFINITY;
}

if (typeof window !== 'undefined') installUserInteractionListener(window);

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
