'use client';
/**
 * header/side-nav.tsx
 *
 * Slide-out side navigation panel rendered by the main Header.
 * Renders the full nav tree via NavItemRenderer and an account footer: the
 * signed-in user on the left, a shortcut to the settings hub on the right.
 */

import { usePathname } from 'next/navigation';
import { Pin, PinOff, Settings, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type NavItem } from './types';
import { NavItemRenderer } from './nav-item';
import type { User as AuthUser } from '@/contexts/AuthContext';
import { openSettings, useSettingsModalStore } from '@/feature/settings/settings-modal-store';

type SideNavProps = {
  /** Ref attached to the nav element for click-outside detection. */
  menuRef: React.RefObject<HTMLDivElement | null>;
  /** Whether the panel is currently visible. */
  isMenuOpen: boolean;
  /** Whether the panel is pinned (stays open on link click). */
  isMenuPinned: boolean;
  /** Toggles the pin state. */
  setIsMenuPinned: (v: boolean) => void;
  /** Closes the panel (no-op when pinned). */
  setIsMenuOpen: (v: boolean) => void;
  /** Filtered nav items to display in the tree. */
  filteredNavItems: NavItem[];
  /** Set of item labels currently expanded. */
  expandedItems: Set<string>;
  /** Toggles expanded state for a given label. */
  toggleExpand: (label: string) => void;
  /** Signed-in user (same auth state as the header toolbar); null when signed out. */
  user: AuthUser | null;
  /** Whether the auth state is still being resolved (name is left blank meanwhile). */
  isAuthLoading: boolean;
};

/**
 * Slide-out navigation panel with a pinnable state and an animated nav tree.
 */
export function SideNav({
  menuRef,
  isMenuOpen,
  isMenuPinned,
  setIsMenuPinned,
  setIsMenuOpen,
  filteredNavItems,
  expandedItems,
  toggleExpand,
  user,
  isAuthLoading,
}: SideNavProps) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const isSettingsOpen = useSettingsModalStore((s) => s.isOpen);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/' || pathname === '/kanban';
    if (href === '#') return false;
    return pathname === href;
  };

  const isChildActive = (item: NavItem): boolean => {
    if (!item.children) return false;
    return item.children.some((child) => {
      if (isActive(child.href)) return true;
      return isChildActive(child);
    });
  };

  return (
    <>
      {/* Dim the page behind the panel for focus. Hidden when pinned so the
          page stays usable alongside the nav. Sits below the header (top-16)
          so the header remains interactive. */}
      <div
        onClick={() => setIsMenuOpen(false)}
        aria-hidden
        className={`fixed inset-x-0 top-16 bottom-0 z-90 bg-zinc-900/20 backdrop-blur-[1px] transition-opacity duration-300 ${
          isMenuOpen && !isMenuPinned ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      <nav
        ref={menuRef}
        className={`fixed left-0 top-16 bottom-0 w-72 flex flex-col bg-white dark:bg-indigo-dark-900 border-r border-zinc-200 dark:border-zinc-800 shadow-lg z-100 transform transition-transform duration-300 ${
          isMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Slim bar: section label + pin toggle. The app name/icon live in the
            header, so they are intentionally not repeated here. */}
        <div className="flex items-center justify-between h-12 px-4 border-b border-zinc-200 dark:border-zinc-800">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
            {t('menu')}
          </span>
          <button
            onClick={() => setIsMenuPinned(!isMenuPinned)}
            className={`p-2 rounded-lg transition-colors ${
              isMenuPinned
                ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/30'
                : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
            aria-label={isMenuPinned ? t('unpinMenu') : t('pinMenu')}
            title={isMenuPinned ? t('unpinMenu') : t('pinMenu')}
          >
            {isMenuPinned ? <PinOff className="w-5 h-5" /> : <Pin className="w-5 h-5" />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col scrollbar-thin">
          <div className="p-4 space-y-1 flex-1">
            {filteredNavItems.map((item) => (
              <NavItemRenderer
                key={item.label}
                item={item}
                depth={0}
                isActive={isActive}
                isChildActive={isChildActive}
                expandedItems={expandedItems}
                toggleExpand={toggleExpand}
                isMenuPinned={isMenuPinned}
                setIsMenuOpen={setIsMenuOpen}
              />
            ))}
          </div>
        </div>

        {/* NOTE: The keyboard-shortcuts button that used to sit here was
            removed: the footer now carries the account and the settings entry.
            The shortcut help itself is unchanged — ⌘/ and OPEN_SHORTCUTS_EVENT
            still open it. Kept outside the scroll area so it never scrolls away. */}
        <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-indigo-dark-900">
          <div className="flex min-w-0 items-center gap-2.5" data-testid="side-nav-account">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
              <User className="w-4 h-4" />
            </span>
            <span
              className={`truncate text-sm ${
                user
                  ? 'font-medium text-zinc-800 dark:text-zinc-100'
                  : 'text-zinc-500 dark:text-zinc-400'
              }`}
              title={user?.username}
            >
              {user ? user.username : isAuthLoading ? '' : t('notSignedIn')}
            </span>
          </div>
          {/* NOTE: Opens the settings modal (was a link to /settings/general).
              The only settings entry besides the account menu's personal one. */}
          <button
            type="button"
            onClick={() => {
              if (!isMenuPinned) setIsMenuOpen(false);
              openSettings();
            }}
            className={`shrink-0 p-2 rounded-lg transition-colors ${
              isSettingsOpen
                ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/30'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
            aria-label={t('settings')}
            title={t('settings')}
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </nav>
    </>
  );
}
