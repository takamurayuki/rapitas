/**
 * link-library-store
 *
 * Saved pages and the groups they belong to — the in-app browser's
 * bookmarks. Separate from `link-view-store`, which owns what is open right
 * now: this is the part that outlives the session.
 *
 * Groups are one concept shared with the tab strip. A group is a name and a
 * colour; tabs reference the same ids, so a page filed under "Design" keeps
 * that colour whether it is a favourite or an open tab.
 *
 * localStorage rather than a table: a Prisma schema change forces a server
 * restart, and this is per-machine UI state. Worth revisiting if favourites
 * should follow the user across machines.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** A group of pages, shown as a coloured heading and a tab marker. */
export interface LinkGroup {
  id: string;
  name: string;
  /** Any CSS colour; drawn as a dot and a tab underline. / 表示色 */
  color: string;
}

/** A saved page. Title and icon come from `POST /url-metadata`. */
export interface LinkFavourite {
  id: string;
  url: string;
  /** Page title, falling back to the host when it could not be read. */
  title: string;
  /** Favicon URL; empty when none was resolved. / ファビコン */
  favicon: string;
  /** The group it is filed under, or null for ungrouped. / 所属グループ */
  groupId: string | null;
}

/** Colours offered when a group is created, in order. */
export const GROUP_COLORS = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
] as const;

interface LinkLibraryState {
  groups: LinkGroup[];
  favourites: LinkFavourite[];
  /** Create a group and return its id. / グループを作成 */
  addGroup: (name: string) => string;
  renameGroup: (id: string, name: string) => void;
  /** Remove a group; its pages and tabs become ungrouped. / グループを削除 */
  removeGroup: (id: string) => void;
  /** Save a page, or update the one already saved for that URL. / 保存 */
  addFavourite: (favourite: Omit<LinkFavourite, 'id'>) => void;
  removeFavourite: (id: string) => void;
  /** Move a saved page to another group, or out of all of them. / 付け替え */
  setFavouriteGroup: (id: string, groupId: string | null) => void;
  /** Whether a URL is already saved. / 保存済みか */
  isFavourite: (url: string) => boolean;
}

let nextId = 0;
const makeId = (prefix: string) => `${prefix}${Date.now().toString(36)}${++nextId}`;

export const useLinkLibraryStore = create<LinkLibraryState>()(
  persist(
    (set, get) => ({
      groups: [],
      favourites: [],

      addGroup: (name) => {
        const id = makeId('g');
        set((state) => ({
          groups: [
            ...state.groups,
            {
              id,
              name: name.trim() || `Group ${state.groups.length + 1}`,
              color: GROUP_COLORS[state.groups.length % GROUP_COLORS.length],
            },
          ],
        }));
        return id;
      },

      renameGroup: (id, name) =>
        set((state) => ({
          groups: state.groups.map((g) =>
            g.id === id ? { ...g, name: name.trim() || g.name } : g,
          ),
        })),

      // Deleting a group must not delete what is filed under it — the pages
      // are the valuable part; the grouping is an arrangement of them.
      removeGroup: (id) =>
        set((state) => ({
          groups: state.groups.filter((g) => g.id !== id),
          favourites: state.favourites.map((f) => (f.groupId === id ? { ...f, groupId: null } : f)),
        })),

      addFavourite: (favourite) =>
        set((state) => {
          const existing = state.favourites.find((f) => f.url === favourite.url);
          // Saving the same page twice updates it rather than duplicating:
          // the title and icon may have been resolved since.
          if (existing) {
            return {
              favourites: state.favourites.map((f) =>
                f.id === existing.id ? { ...f, ...favourite } : f,
              ),
            };
          }
          return { favourites: [...state.favourites, { ...favourite, id: makeId('f') }] };
        }),

      removeFavourite: (id) =>
        set((state) => ({ favourites: state.favourites.filter((f) => f.id !== id) })),

      setFavouriteGroup: (id, groupId) =>
        set((state) => ({
          favourites: state.favourites.map((f) => (f.id === id ? { ...f, groupId } : f)),
        })),

      isFavourite: (url) => get().favourites.some((f) => f.url === url),
    }),
    { name: 'rapitas-link-library' },
  ),
);

/**
 * Saved pages arranged for display: each group with its pages, then the
 * ungrouped ones.
 *
 * Groups with nothing in them are kept — a group made before anything was
 * filed into it should not vanish while the user is about to fill it.
 *
 * @param groups - Every group / 全グループ
 * @param favourites - Every saved page / 全お気に入り
 * @returns Sections in display order / 表示順のセクション
 */
export function groupFavourites(
  groups: LinkGroup[],
  favourites: LinkFavourite[],
): { group: LinkGroup | null; items: LinkFavourite[] }[] {
  const sections = groups.map((group) => ({
    group,
    items: favourites.filter((f) => f.groupId === group.id),
  }));
  const loose = favourites.filter((f) => !f.groupId || !groups.some((g) => g.id === f.groupId));
  return loose.length > 0 ? [...sections, { group: null, items: loose }] : sections;
}
