/**
 * settings-link
 *
 * Turns the old /settings/* page URLs into settings-modal sections. Those
 * URLs no longer exist as pages, but they still arrive from the backend
 * (notification links, smart-command and voice-command routes) and from
 * notifications already stored in the database, so every place that follows
 * an in-app link goes through `followInAppLink` instead of router.push.
 */
import { openSettings, type SettingsSectionId } from './settings-modal-store';

const PATH_TO_SECTION: Record<string, SettingsSectionId> = {
  // The bare /settings page was the API-key page.
  '/settings': 'api-keys',
  '/settings/personal': 'personal',
  '/settings/general': 'general',
  '/settings/developer-mode': 'developer-mode',
  '/settings/shortcuts': 'shortcuts',
  '/settings/cli-tools': 'cli-tools',
};

/**
 * Finds the settings section an old /settings URL pointed at.
 *
 * @param href - An in-app href, possibly with query or hash / アプリ内のリンク
 * @returns The section, or null when the href is not a settings page / 設定ページでなければ null
 */
export function settingsSectionFromHref(href: string): SettingsSectionId | null {
  let pathname: string;
  try {
    pathname = new URL(href, 'http://in-app.invalid').pathname;
  } catch {
    return null;
  }
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return PATH_TO_SECTION[trimmed] ?? null;
}

/** The subset of the Next.js router this module needs. */
interface PushRouter {
  push: (href: string) => void;
}

/**
 * Follows an in-app link: settings URLs open the settings modal, anything
 * else navigates as before.
 *
 * @param router - The app router (or anything with push) / ルーター
 * @param href - The link to follow / 遷移先
 */
export function followInAppLink(router: PushRouter, href: string): void {
  const section = settingsSectionFromHref(href);
  if (section) {
    openSettings(section);
    return;
  }
  router.push(href);
}
