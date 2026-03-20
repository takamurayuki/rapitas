'use client';
/**
 * header/side-nav.tsx
 *
 * Slide-out side navigation panel rendered by the main Header.
 * Renders the full nav tree via NavItemRenderer and a keyboard-shortcuts footer button.
 */

import { usePathname } from 'next/navigation';
import { Keyboard, Pin, PinOff } from 'lucide-react';
import AppIcon from '@/components/app-icon';
import { OPEN_SHORTCUTS_EVENT } from '@/components/KeyboardShortcuts';
import { useTranslations } from 'next-intl';
import { type NavItem } from './types';
import { NavItemRenderer } from './nav-item';
import type { ShortcutId } from '@/stores/shortcutStore';

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
  /** Returns a formatted shortcut string for a given id. */
  getShortcutLabel: (id: ShortcutId) => string | undefined;
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
  getShortcutLabel,
}: SideNavProps) {
  const pathname = usePathname();
  const t = useTranslations('nav');

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
    <nav
      ref={menuRef}
      className={`fixed left-0 top-0 h-full w-72 flex flex-col bg-white dark:bg-indigo-dark-900 shadow-2xl z-100 transform transition-transform duration-300 ${
        isMenuOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-400 shadow-md">
            <AppIcon size={20} className="text-white" />
          </div>
          <span className="text-lg font-bold bg-indigo-400 bg-clip-text text-transparent">
            Rapi+
          </span>
        </div>
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
          {isMenuPinned ? (
            <PinOff className="w-5 h-5" />
          ) : (
            <Pin className="w-5 h-5" />
          )}
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

        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => {
              if (!isMenuPinned) {
                setIsMenuOpen(false);
              }
              window.dispatchEvent(new CustomEvent(OPEN_SHORTCUTS_EVENT));
            }}
            className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <div className="flex items-center gap-3">
              <Keyboard className="w-4 h-4" />
              <span className="text-sm">{t('keyboardShortcuts')}</span>
            </div>
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700">
              {getShortcutLabel('shortcutHelp') || '⌘/'}
            </kbd>
          </button>
        </div>
      </div>
    </nav>
  );
}
