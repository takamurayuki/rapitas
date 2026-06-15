'use client';
/**
 * header/header.tsx
 *
 * Main Header orchestrator component.
 * Composes the sticky top bar, slide-out side navigation panel,
 * and restart dialogs. All state logic lives in useHeader().
 */

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import AppIcon from '@/components/common/app-icon';
import { useTranslations } from 'next-intl';
import {
  Home,
  Columns3,
  Tags,
  SwatchBook,
  FolderOpen,
  FolderKanban,
  FolderGit2,
  ScrollText,
  Target,
  BarChart3,
  GanttChartSquare,
  Flame,
  Brain,
  FileText,
  FileCog,
  Calendar,
  CalendarClock,
  Clock,
  GraduationCap,
  Bot,
  Settings,
  GitPullRequest,
  CircleDot,
  Workflow,
  Code,
  Key,
  MessageSquare,
  Sparkles,
  Lightbulb,
  Bug,
  Inbox,
  NotebookTabs,
  Package,
  BookMarked,
  Keyboard,
  Scale,
} from 'lucide-react';
import { useHeader } from './useHeader';
import { type NavItem } from './types';
import { SideNav } from './side-nav';
import { HeaderSearch } from './header-search';
import { HeaderToolbar } from './header-toolbar';
import { RestartDialogs } from './restart-dialogs';
import type { AppMode } from '@/stores/app-mode-store';

/**
 * Filters nav items to only include those visible in the given app mode.
 *
 * @param items - Full nav item list / 全ナビアイテムリスト
 * @param currentMode - Current application mode / 現在のアプリモード
 * @returns Filtered nav items / フィルタリングされたナビアイテム
 */
function filterNavItems(items: NavItem[], currentMode: AppMode): NavItem[] {
  if (currentMode === 'all') return items;
  return items.filter((item) => {
    if (!item.mode) return true;
    return item.mode === currentMode;
  });
}

/**
 * Sticky application header with a hamburger-triggered side navigation panel.
 */
export default function Header() {
  const h = useHeader();
  const t = useTranslations('nav');

  if (h.hideHeader || (h.isTaskDetailPage && !h.showHeader)) {
    return null;
  }

  const navItems: NavItem[] = [
    {
      href: '/',
      label: t('taskList'),
      icon: Home,
      shortcut: h.getShortcutLabel('home'),
      children: [
        { href: '/gantt', label: 'ガントチャート', icon: GanttChartSquare },
        {
          href: '#',
          label: t('category'),
          icon: FolderOpen,
          children: [
            {
              href: '/categories',
              label: t('categoryList'),
              icon: FolderKanban,
            },
            { href: '/themes', label: t('themeList'), icon: SwatchBook },
            { href: '/labels', label: t('labelList'), icon: Tags },
          ],
        },
        {
          href: '/settings/developer-mode',
          label: t('taskSettings'),
          icon: Settings,
        },
      ],
    },
    {
      href: '#',
      label: 'バックログ',
      icon: Inbox,
      children: [
        { href: '/ideas', label: 'アイデアボックス', icon: Lightbulb },
        { href: '/concerns', label: '懸念バックログ', icon: Bug },
        { href: '/decisions', label: 'デシジョンジャーナル', icon: Scale },
        { href: '/backlog/settings', label: '設定', icon: CalendarClock },
      ],
    },
    {
      href: '/dashboard',
      label: t('dashboard'),
      icon: BarChart3,
      shortcut: h.getShortcutLabel('dashboard'),
    },
    {
      href: '#',
      label: t('learning'),
      icon: GraduationCap,
      mode: 'learning',
      children: [
        {
          href: '/learning-goals',
          label: t('learningGoals'),
          icon: BookMarked,
        },
        { href: '/exam-goals', label: t('examGoals'), icon: Target },
      ],
    },
    {
      href: '#',
      label: t('habitsAchievements'),
      icon: Calendar,
      children: [
        {
          href: '/calendar',
          label: t('calendar'),
          icon: Calendar,
          shortcut: h.getShortcutLabel('calendar'),
        },
        { href: '/habits', label: t('habitTracker'), icon: Flame },
        {
          href: '/habits/daily-schedule',
          label: t('dailySchedule'),
          icon: Clock,
        },
        { href: '/reports', label: t('weeklyReport'), icon: FileText },
      ],
    },
    {
      href: '#',
      label: t('development'),
      icon: Code,
      mode: 'development',
      children: [
        {
          href: '#',
          label: 'GitHub',
          icon: Code,
          children: [
            { href: '/github', label: t('devDashboard'), icon: FolderGit2 },
            {
              href: '/github/pull-requests',
              label: 'Pull Requests',
              icon: GitPullRequest,
            },
            { href: '/github/issues', label: 'Issues', icon: CircleDot },
            { href: '/github/actions', label: 'CI/CD', icon: Workflow },
          ],
        },
        { href: '/logs', label: 'ログ分析', icon: ScrollText },
        {
          href: '#',
          label: t('agent'),
          icon: Bot,
          children: [
            { href: '/agents', label: t('agentManagement'), icon: Settings },
            { href: '/agents/metrics', label: t('metrics'), icon: BarChart3 },
            {
              href: '/agents/versions',
              label: t('versionControl'),
              icon: Package,
            },
            {
              href: '/agents/memory',
              label: t('memoryVisualization'),
              icon: Sparkles,
            },
            {
              href: '#',
              label: t('knowledgeBase'),
              icon: Brain,
              children: [
                {
                  href: '/knowledge',
                  label: t('knowledgeBrowser'),
                  icon: Brain,
                },
                {
                  href: '/knowledge/contradictions',
                  label: t('contradictions'),
                  icon: NotebookTabs,
                },
                {
                  href: '/knowledge/admin',
                  label: t('memoryAdmin'),
                  icon: Settings,
                },
              ],
            },
          ],
        },
        {
          href: '/system-prompts',
          label: t('promptManagement'),
          icon: MessageSquare,
        },
        {
          href: '/claude-md-generator',
          label: t('claudeGeneration'),
          icon: FileCog,
        },
        { href: '/settings/cli-tools', label: t('cliTools'), icon: Package },
      ],
    },
    {
      href: '#',
      label: t('settings'),
      icon: Settings,
      children: [
        {
          href: '/settings/general',
          label: t('generalSettings'),
          icon: Settings,
        },
        { href: '/settings', label: t('apiKeySettings'), icon: Key },
        {
          href: '/settings/shortcuts',
          label: t('shortcutSettings'),
          icon: Keyboard,
        },
      ],
    },
  ];

  const filteredNavItems = filterNavItems(navItems, h.appMode);

  return (
    <>
      {/* z-110: above the task slide panel (z-50) and side nav (z-100) so header
          menus are never hidden behind them, but below modal dialogs (z-200). */}
      <header className="sticky top-0 z-110 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-indigo-dark-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <button
                onClick={() => h.setIsMenuOpen(!h.isMenuOpen)}
                className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                aria-label={t('openMenu')}
              >
                {h.isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>

              <Link href="/" className="flex items-center gap-2 group">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-8 h-8 bg-indigo-500 rounded-lg">
                    <AppIcon size={20} className="text-white" />
                  </div>
                  <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                    Rapi+
                  </span>
                </div>
              </Link>
            </div>

            <HeaderSearch
              searchQuery={h.searchQuery}
              setSearchQuery={h.setSearchQuery}
              handleSearchKeyDown={h.handleSearchKeyDown}
              debounceTimerRef={h.debounceTimerRef}
            />

            <HeaderToolbar
              hasMounted={h.hasMounted}
              isAuthLoading={h.isAuthLoading}
              isAuthenticated={h.isAuthenticated}
              user={h.user}
              isUserMenuOpen={h.isUserMenuOpen}
              setIsUserMenuOpen={h.setIsUserMenuOpen}
              userMenuRef={h.userMenuRef}
              handleLogout={h.handleLogout}
              isMoreMenuOpen={h.isMoreMenuOpen}
              setIsMoreMenuOpen={h.setIsMoreMenuOpen}
              moreMenuRef={h.moreMenuRef}
              modalState={h.modalState}
              openModal={h.openModal}
              closeModal={h.closeModal}
              isDarkMode={h.isDarkMode}
              darkModeMounted={h.darkModeMounted}
              toggleTheme={h.toggleTheme}
              isTauriEnv={h.isTauriEnv}
              isRestarting={h.isRestarting}
              handleRestartClick={h.handleRestartClick}
            />
          </div>
        </div>
      </header>

      <SideNav
        menuRef={h.menuRef}
        isMenuOpen={h.isMenuOpen}
        isMenuPinned={h.isMenuPinned}
        setIsMenuPinned={h.setIsMenuPinned}
        setIsMenuOpen={h.setIsMenuOpen}
        filteredNavItems={filteredNavItems}
        expandedItems={h.expandedItems}
        toggleExpand={h.toggleExpand}
        getShortcutLabel={h.getShortcutLabel}
      />

      <RestartDialogs
        restartConfirmDialog={h.restartConfirmDialog}
        setRestartConfirmDialog={h.setRestartConfirmDialog}
        executeRestart={h.executeRestart}
        isRestarting={h.isRestarting}
      />

      <style jsx global>{`
        .line-animate-vertical {
          transform-origin: top;
          transform: scaleY(0);
          animation: draw-vertical var(--line-duration, 0.22s) ease-out forwards;
          animation-delay: var(--line-delay, 0s);
          will-change: transform;
        }

        .line-animate-horizontal {
          transform-origin: left;
          transform: scaleX(0);
          animation: draw-horizontal var(--line-duration, 0.22s) ease-out forwards;
          animation-delay: calc(var(--line-delay, 0s) + var(--line-stagger, 0.12s));
          will-change: transform;
        }

        @keyframes draw-vertical {
          from {
            transform: scaleY(0);
          }
          to {
            transform: scaleY(1);
          }
        }

        @keyframes draw-horizontal {
          from {
            transform: scaleX(0);
          }
          to {
            transform: scaleX(1);
          }
        }
      `}</style>
    </>
  );
}
