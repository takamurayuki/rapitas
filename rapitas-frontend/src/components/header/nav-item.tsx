'use client';
/**
 * header/nav-item.tsx
 *
 * Recursive nav item renderer for the Header side navigation panel.
 * Handles nested children with animated connector lines at arbitrary depth.
 */

import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type NavItem, type LineStyle, lineStyle, getLineDelay } from './types';

type NavItemProps = {
  /** The nav item definition to render. / レンダリングするナビアイテム定義 */
  item: NavItem;
  /** Nesting depth, starting at 0. / ネストの深さ（0始まり） */
  depth: number;
  /** Whether the direct parent item is in an expanded state. / 直親アイテムが展開状態かどうか */
  parentExpanded?: boolean;
  /** Whether the item's href is the currently active route. / アイテムのhrefが現在アクティブなルートかどうか */
  isActive: (href: string) => boolean;
  /** Whether any descendant of the item is active. / アイテムの子孫がアクティブかどうか */
  isChildActive: (item: NavItem) => boolean;
  /** Set of item labels that are currently expanded. / 現在展開中のアイテムラベルのセット */
  expandedItems: Set<string>;
  /** Toggle the expanded state for an item by label. / ラベルでアイテムの展開状態をトグル */
  toggleExpand: (label: string) => void;
  /** Whether the side nav is pinned open (prevents auto-close on link click). / サイドナビがピン留め状態かどうか */
  isMenuPinned: boolean;
  /** Closes the side nav (no-op when pinned). / サイドナビを閉じる（ピン留め時は無効） */
  setIsMenuOpen: (v: boolean) => void;
};

/**
 * Renders a single navigation item and, if expanded, its children recursively.
 */
export function NavItemRenderer({
  item,
  depth,
  parentExpanded = true,
  isActive,
  isChildActive,
  expandedItems,
  toggleExpand,
  isMenuPinned,
  setIsMenuOpen,
}: NavItemProps): React.ReactNode {
  const Icon = item.icon;
  const active = isActive(item.href);
  const hasChildren = item.children && item.children.length > 0;
  const isExpanded = expandedItems.has(item.label);
  const childActive = isChildActive(item);
  const hasValidLink = item.href !== '#';

  const childProps = {
    isActive,
    isChildActive,
    expandedItems,
    toggleExpand,
    isMenuPinned,
    setIsMenuOpen,
  };

  if (depth === 0) {
    if (hasChildren) {
      return (
        <div key={item.label}>
          {hasValidLink ? (
            <div
              className={`flex items-center justify-between gap-1 px-4 py-3 rounded-lg transition-all ${
                active || childActive
                  ? 'bg-indigo-50 dark:bg-indigo-900/20'
                  : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <Link
                href={item.href}
                onClick={() => !isMenuPinned && setIsMenuOpen(false)}
                className={`flex-1 flex items-center gap-3 ${
                  active
                    ? 'text-indigo-700 dark:text-indigo-300 font-semibold'
                    : childActive
                      ? 'text-indigo-700 dark:text-indigo-300'
                      : 'text-zinc-700 dark:text-zinc-300'
                }`}
              >
                <Icon
                  className={`w-5 h-5 shrink-0 ${active ? 'text-indigo-600 dark:text-indigo-400' : ''}`}
                />
                <span className="font-medium">{item.label}</span>
                {item.shortcut && (
                  <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700">
                    {item.shortcut}
                  </kbd>
                )}
              </Link>
              <button
                onClick={() => toggleExpand(item.label)}
                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>
            </div>
          ) : (
            <button
              onClick={() => toggleExpand(item.label)}
              className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg transition-all ${
                childActive
                  ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                  : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className="w-5 h-5 shrink-0" />
                <span className="font-medium">{item.label}</span>
              </div>
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          )}
          {isExpanded && (
            <div className="ml-[26px]">
              {item.children!.map((child, index) => {
                const isLastChild = index === item.children!.length - 1;
                return (
                  <div key={child.label} className="relative">
                    <div
                      className={`absolute left-0 top-0 w-px bg-zinc-300 dark:bg-zinc-600 ${isLastChild ? 'h-5' : 'h-full'} ${
                        isExpanded ? 'line-animate-vertical' : ''
                      }`}
                      style={lineStyle(getLineDelay(depth, index)) as LineStyle}
                    />
                    <NavItemRenderer
                      item={child}
                      depth={depth + 1}
                      parentExpanded={isExpanded}
                      {...childProps}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => !isMenuPinned && setIsMenuOpen(false)}
        className={`flex items-center justify-between gap-3 px-4 py-3 rounded-md transition-all ${
          active
            ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-semibold border-l-2 border-indigo-500'
            : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
        }`}
      >
        <div className="flex items-center gap-3">
          <Icon
            className={`w-5 h-5 shrink-0 ${active ? 'text-indigo-600 dark:text-indigo-400' : ''}`}
          />
          <span className="font-medium">{item.label}</span>
        </div>
        {item.shortcut && (
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700">
            {item.shortcut}
          </kbd>
        )}
      </Link>
    );
  }

  // Depth > 0 — nested items with connector lines
  if (hasChildren) {
    return (
      <div key={item.label}>
        <div className="relative h-10 flex items-center">
          <div
            className={`absolute left-0 top-1/2 w-4 h-px bg-zinc-300 dark:bg-zinc-600 ${
              parentExpanded ? 'line-animate-horizontal' : ''
            }`}
            style={lineStyle(getLineDelay(depth, 0)) as LineStyle}
          />
          <div className="ml-5 flex-1">
            {hasValidLink ? (
              <div
                className={`flex items-center justify-between gap-1 px-3 py-1.5 rounded-md transition-all ${
                  active || childActive
                    ? 'bg-indigo-50 dark:bg-indigo-900/20'
                    : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <Link
                  href={item.href}
                  onClick={() => !isMenuPinned && setIsMenuOpen(false)}
                  className={`flex-1 flex items-center gap-2.5 ${
                    active
                      ? 'text-indigo-700 dark:text-indigo-300 font-semibold'
                      : childActive
                        ? 'text-indigo-700 dark:text-indigo-300'
                        : 'text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${active ? 'text-indigo-600 dark:text-indigo-400' : ''}`}
                  />
                  <span className="text-sm">{item.label}</span>
                </Link>
                <button
                  onClick={() => toggleExpand(item.label)}
                  className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            ) : (
              <button
                onClick={() => toggleExpand(item.label)}
                className={`w-full flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-md transition-all ${
                  childActive
                    ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="text-sm">{item.label}</span>
                </div>
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>
        </div>
        {isExpanded && (
          <div className="ml-10">
            {item.children!.map((child, index) => {
              const isLastChild = index === item.children!.length - 1;
              return (
                <div key={child.label} className="relative">
                  <div
                    className={`absolute left-0 top-0 w-px bg-zinc-300 dark:bg-zinc-600 ${isLastChild ? 'h-5' : 'h-full'} ${
                      parentExpanded ? 'line-animate-vertical' : ''
                    }`}
                    style={lineStyle(getLineDelay(depth, index)) as LineStyle}
                  />
                  <NavItemRenderer
                    item={child}
                    depth={depth + 1}
                    parentExpanded={isExpanded && parentExpanded}
                    {...childProps}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div key={item.href} className="relative h-10 flex items-center">
      <div
        className={`absolute left-0 top-1/2 w-4 h-px bg-zinc-300 dark:bg-zinc-600 ${
          parentExpanded ? 'line-animate-horizontal' : ''
        }`}
        style={lineStyle(getLineDelay(depth, 0)) as LineStyle}
      />
      <Link
        href={item.href}
        onClick={() => !isMenuPinned && setIsMenuOpen(false)}
        className={`ml-5 flex items-center gap-2.5 px-3 py-1.5 rounded-md transition-all ${
          active
            ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-semibold border-l-2 border-indigo-500'
            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
        }`}
      >
        <Icon
          className={`w-4 h-4 shrink-0 ${active ? 'text-indigo-600 dark:text-indigo-400' : ''}`}
        />
        <span className="text-sm">{item.label}</span>
      </Link>
    </div>
  );
}
