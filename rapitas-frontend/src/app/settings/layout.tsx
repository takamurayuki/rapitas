'use client';
/**
 * settings/layout.tsx
 *
 * Shared shell for every settings route: a sticky tab bar that unifies the
 * previously-scattered settings pages (general / API keys / task automation /
 * shortcuts / CLI tools) into one navigable hub. Page content renders below.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** One settings destination shown in the hub tab bar. */
type SettingsTab = {
  href: string;
  label: string;
};

const SETTINGS_TABS: SettingsTab[] = [
  { href: '/settings/general', label: '一般' },
  { href: '/settings', label: 'APIキー・モデル' },
  { href: '/settings/developer-mode', label: 'タスク自動実行' },
  { href: '/settings/shortcuts', label: 'ショートカット' },
  { href: '/settings/cli-tools', label: 'CLIツール' },
];

/**
 * Determines whether a tab is the active one for the current path.
 *
 * The API-keys tab lives at the bare `/settings` index, which is a prefix of
 * every other tab, so it must match exactly; the rest match their subtree.
 *
 * @param tabHref - The tab's destination href / タブの遷移先
 * @param pathname - The current pathname / 現在のパス
 * @returns Whether the tab should render as active / アクティブ表示するか
 */
function isTabActive(tabHref: string, pathname: string): boolean {
  if (tabHref === '/settings') return pathname === '/settings';
  return pathname === tabHref || pathname.startsWith(`${tabHref}/`);
}

/**
 * Renders the settings hub tab bar above the active settings page.
 *
 * @param children - The active settings route's content / アクティブな設定ページの内容
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';

  return (
    <div>
      <div className="sticky top-16 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-indigo-dark-900/95 backdrop-blur">
        <nav
          aria-label="設定"
          className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8 scrollbar-thin"
        >
          {SETTINGS_TABS.map((tab) => {
            const active = isTabActive(tab.href, pathname);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`shrink-0 border-b-2 px-3 py-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  active
                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {children}
    </div>
  );
}
