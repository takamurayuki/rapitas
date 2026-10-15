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
 * Build a Headers object from a RequestInit, tagged with the UI source header.
 *
 * Normalizes all three `HeadersInit` shapes (plain object / Headers instance /
 * `[key, value][]` array) via the `Headers` constructor — a naive object
 * spread would silently drop the latter two. A caller-provided
 * `x-rapitas-source` value is preserved (caller-wins, matching the
 * api-client header-merge convention).
 *
 * @param init - The RequestInit whose headers to merge / ヘッダを取り込む元のRequestInit
 * @returns Headers with the UI source header set / UIソースヘッダ付きのHeaders
 */
export function mergeUiSourceHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  if (!headers.has(UI_SOURCE_HEADER)) {
    headers.set(UI_SOURCE_HEADER, UI_SOURCE_VALUE);
  }
  return headers;
}
