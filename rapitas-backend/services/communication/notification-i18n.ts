/**
 * Notification i18n
 *
 * Builds the `{key, params}` pointer stored under `Notification.metadata.i18n`
 * so the frontend can re-render title/message in the active UI locale. Not
 * responsible for storing or delivering notifications — see
 * notification-service.ts (createNotification) for that.
 */

/** i18n pointer embedded in `Notification.metadata.i18n`. */
export interface NotificationI18n {
  key: string;
  params?: Record<string, unknown>;
}

/**
 * Build the i18n metadata for a notification.
 *
 * The frontend resolves the title via `t(key, params)` and the message via
 * the sibling key with `.title` replaced by `.message` (same params) — see
 * `resolveNotificationText` in notification-type-icons.ts. `key` need not
 * match the stored `Notification.type` field 1:1: callers may pass a more
 * specific i18n key (e.g. `task_created_subtask`) to select a text variant
 * while keeping the DB `type` stable for icon/dedup lookups.
 *
 * @param key - i18n key suffix, resolved as `notification.types.<key>.title`. / i18nキーの接尾辞
 * @param params - Dynamic values to interpolate (undefined/null entries are dropped). / 動的パラメータ
 * @returns The i18n pointer to embed in `Notification.metadata.i18n`. / metadata.i18n に埋め込む値
 */
export function buildNotificationI18n(
  key: string,
  params?: Record<string, unknown>,
): NotificationI18n {
  const cleanParams = params
    ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null))
    : undefined;
  return cleanParams && Object.keys(cleanParams).length > 0
    ? { key: `notification.types.${key}.title`, params: cleanParams }
    : { key: `notification.types.${key}.title` };
}
