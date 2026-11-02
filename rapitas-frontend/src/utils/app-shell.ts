/**
 * app-shell
 *
 * Answers which routes render bare — without the header, its side nav, or the
 * resident avatar. Not responsible for rendering any of them: it exists so the
 * chrome that appears and the page layout that makes room for it cannot
 * disagree about where they are.
 */

/**
 * Routes that render without the app shell: the sign-in pages, and the
 * frameless popup windows (quick capture, notification toast, pomodoro float).
 */
const SHELL_LESS_PREFIXES = [
  '/auth',
  '/quick-capture',
  '/notification-toast',
  '/pomodoro-float',
] as const;

/**
 * Whether this route renders without the header, the side nav and the avatar.
 *
 * Matches a whole path segment, so a future `/authors` page is not mistaken
 * for `/auth`.
 *
 * @param pathname - The current route / 現在のパス
 * @returns true when no app shell is rendered / アプリシェルを描画しない場合 true
 */
export function isAppShellHidden(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return SHELL_LESS_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
