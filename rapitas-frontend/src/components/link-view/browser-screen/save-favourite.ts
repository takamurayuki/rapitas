/**
 * save-favourite
 *
 * Save an open tab to the favourites, resolving its title and icon first
 * through the same endpoint the note editor's link cards use. Shared by the
 * docked pane and the /browser screen.
 *
 * Falls back to the host rather than failing: a saved page with a plain
 * title beats a save that silently did nothing.
 */
import { API_BASE_URL } from '@/utils/api';
import { useLinkLibraryStore } from '@/stores/link-library-store';
import type { LinkTab } from '@/stores/link-view-store';
import { hostOf } from '../link-tab-meta';

/**
 * @param tab - The tab to save / 保存するタブ
 */
export async function saveTabToFavourites(tab: LinkTab): Promise<void> {
  let title = hostOf(tab.url);
  let favicon = '';
  try {
    const res = await fetch(`${API_BASE_URL}/url-metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: tab.url }),
    });
    const meta = await res.json();
    title = meta.title || title;
    favicon = meta.favicon || '';
  } catch {
    // Keep the host-derived title.
  }
  useLinkLibraryStore
    .getState()
    .addFavourite({ url: tab.url, title, favicon, groupId: tab.groupId ?? null });
}
