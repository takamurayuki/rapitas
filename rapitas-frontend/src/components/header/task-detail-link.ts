/**
 * task-detail-link
 *
 * One rule for building links into the task-detail page.
 *
 * That page hides the global header unless `showHeader=true` is in the
 * query (see `Header`), so a link that omits it drops the header and takes
 * the way back with it. The rule lived inside `NotificationBell` and was
 * applied there alone; it is here so every caller can reach it.
 *
 * Not responsible for deciding whether a path IS a task-detail page — that
 * is `checkIsTaskDetailPage`, which this uses.
 */
import { checkIsTaskDetailPage } from './types';

/**
 * Keep the global header visible when a link opens a task detail.
 *
 * Applied at navigation time rather than when a link is stored, so links
 * already written down are fixed too. A link that already says
 * `showHeader` is left alone, and a path that is not a task detail is
 * returned untouched.
 *
 * @param link - Where the navigation is going / 遷移先のリンク
 * @returns The link, with showHeader=true when it needs it / 必要なら付与したリンク
 */
export function withHeaderVisible(link: string): string {
  const [path, query] = link.split('?');
  if (!checkIsTaskDetailPage(path)) return link;
  const params = new URLSearchParams(query ?? '');
  if (params.has('showHeader')) return link;
  params.set('showHeader', 'true');
  return `${path}?${params.toString()}`;
}
