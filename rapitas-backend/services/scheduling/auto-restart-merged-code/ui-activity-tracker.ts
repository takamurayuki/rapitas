/**
 * UiActivityTracker
 *
 * In-memory record of the most recent UI-originated API request (requests
 * tagged with the `X-Rapitas-Source: ui` header), consumed by the boundary
 * restart's UI-quiet gate. Memory-only on purpose: right after a restart the
 * UI is by definition quiet, so 0 is the correct initial state and no
 * persistence is needed. Not responsible for deciding anything — see
 * boundary-policy.ts.
 */

/** Header name (lowercase — Fetch API header lookups are case-insensitive). */
export const UI_SOURCE_HEADER = 'x-rapitas-source';

/** Header value marking a request as user-originated from the UI. */
export const UI_SOURCE_VALUE = 'ui';

let lastUiRequestAt = 0;

/**
 * Record a UI-originated request timestamp. Monotonic: an older (or
 * non-finite) timestamp never rewinds the record, so a clock hiccup cannot
 * shrink the perceived activity window.
 *
 * @param timestampMs - Epoch ms of the request / リクエスト時刻（エポックms）
 */
export function recordUiRequest(timestampMs: number): void {
  if (Number.isFinite(timestampMs) && timestampMs > lastUiRequestAt) {
    lastUiRequestAt = timestampMs;
  }
}

/**
 * Read the last UI-originated request timestamp.
 *
 * @returns Epoch ms of the last UI request, or 0 when none was ever recorded / 最終UIリクエスト時刻（未記録時0）
 */
export function getLastUiRequestAt(): number {
  return lastUiRequestAt;
}

/**
 * Reset the record to the never-recorded state (tests only).
 */
export function resetUiActivity(): void {
  lastUiRequestAt = 0;
}
