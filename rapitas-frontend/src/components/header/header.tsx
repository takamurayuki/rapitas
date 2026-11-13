'use client';
/**
 * header/header.tsx
 *
 * Main Header orchestrator component.
 * Composes the sticky top bar, slide-out side navigation panel,
 * and restart dialogs. All state logic lives in useHeader().
 */

import {
  Menu,
  X,
  Home,
  Tags,
  SwatchBook,
  LayoutList,
  LayoutDashboard,
  Folders,
  FolderGit2,
  ScrollText,
  Mountain,
  BarChart3,
  GanttChartSquare,
  FileText,
  FileCog,
  Calendar,
  CalendarRange,
  CalendarClock,
  Clock,
  Bot,
  UserCog,
  Archive,
  GitPullRequest,
  CircleDot,
  GitMerge,
  Code,
  MessageSquare,
  Lightbulb,
  Bug,
  Inbox,
  NotebookTabs,
  Beaker,
  Sprout,
  Sunrise,
  Library,
  Search,
  Workflow,
  ChartNoAxesCombined,
  ChartScatter,
  GitGraph,
  ScanSearch,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useHeader } from './useHeader';
import { type NavItem } from './types';
import { GithubMarkIcon } from '@/components/icons/github-mark-icon';
import { SideNav } from './side-nav';
import { HeaderSearch } from './header-search';
import { HeaderToolbar } from './header-toolbar';
import { RestartDialogs } from './restart-dialogs';
import { HistoryNavButtons } from './history';

/**
 * Sticky application header with a hamburger-triggered side navigation panel.
 */
export default function Header() {
  const h = useHeader();
  const t = useTranslations('nav');
  const tTask = useTranslations('task');

  if (h.hideHeader || (h.isTaskDetailPage && !h.showHeader)) {
    return null;
  }

  const navItems: NavItem[] = [
    // Goals come first: the product's axis is carrying a person's goal through
    // its milestones; the task list is how the work for them gets done.
    { href: '/goals', label: t('goals'), icon: Mountain },
    {
      href: '/',
      label: t('taskList'),
      icon: Home,
      shortcut: h.getShortcutLabel('home'),
      children: [
        { href: '/gantt', label: tTask('ganttView.title'), icon: GanttChartSquare },
        {
          href: '#',
          label: t('category'),
          icon: LayoutList,
          children: [
            {
              href: '/categories',
              label: t('categoryList'),
              icon: Folders,
            },
            { href: '/themes', label: t('themeList'), icon: SwatchBook },
            { href: '/labels', label: t('labelList'), icon: Tags },
          ],
        },
      ],
    },
    {
      href: '#',
      label: t('backlog'),
      icon: Inbox,
      children: [
        { href: '/ideas', label: t('ideas'), icon: Lightbulb },
        { href: '/concerns', label: t('concerns'), icon: Bug },
        { href: '/hypotheses', label: t('hypotheses'), icon: Beaker },
        { href: '/backlog/settings', label: t('settings'), icon: CalendarClock },
      ],
    },
    {
      href: '/dashboard',
      label: t('dashboard'),
      icon: LayoutDashboard,
      shortcut: h.getShortcutLabel('dashboard'),
    },
    {
      href: '/notes',
      label: t('notes'),
      icon: NotebookTabs,
    },
    {
      href: '#',
      label: t('habitsAchievements'),
      icon: CalendarRange,
      children: [
        {
          href: '/calendar',
          label: t('calendar'),
          icon: Calendar,
          shortcut: h.getShortcutLabel('calendar'),
        },
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
      children: [
        {
          href: '#',
          label: 'GitHub',
          icon: GithubMarkIcon,
          children: [
            { href: '/github', label: t('devDashboard'), icon: FolderGit2 },
            {
              href: '/github/pull-requests',
              label: 'Pull Requests',
              icon: GitPullRequest,
            },
            { href: '/github/issues', label: 'Issues', icon: CircleDot },
            { href: '/github/actions', label: 'CI/CD', icon: GitMerge },
          ],
        },
        { href: '/logs', label: t('logAnalysis'), icon: ScrollText },
        {
          href: '#',
          label: t('agent'),
          icon: Bot,
          children: [
            // NOTE: UserCog, not Settings — the gear glyph is owned by 設定
            // (ICON_POLICY: one glyph, one meaning app-wide).
            { href: '/agents', label: t('agentManagement'), icon: UserCog },
            {
              href: '/agents/execution-dashboard',
              label: t('executionDashboard'),
              icon: Workflow,
            },
            { href: '/agents/metrics', label: t('metrics'), icon: BarChart3 },
            // NOTE: Sunrise = 自律活動デイリーレポート (ICON_POLICY §3) — the
            // same glyph is reused on the /agents/daily-report page (same
            // concept). /agents/growth is owned by the growth ledger below.
            {
              href: '/agents/daily-report',
              label: t('growthReport'),
              icon: Sunrise,
            },
            {
              href: '/agents/memory',
              label: t('memoryVisualization'),
              icon: Sprout,
            },
            {
              href: '/agents/growth',
              label: t('growthLedger'),
              icon: ChartNoAxesCombined,
            },
            // NOTE: ChartScatter = 効率フロンティア (ICON_POLICY glyphs-a-f) — the
            // same glyph is reused on the /agents/pareto page (same concept).
            {
              href: '/agents/pareto',
              label: t('paretoFrontier'),
              icon: ChartScatter,
            },
            // NOTE: GitGraph = 失敗の系譜図 (ICON_POLICY glyphs-g-m).
            {
              href: '/agents/failure-lineage',
              label: t('failureLineage'),
              icon: GitGraph,
            },
            // NOTE: ScanSearch = 検出漏れ兆候の学習・レビュー (ICON_POLICY §3).
            {
              href: '/agents/miss-signatures',
              label: t('missSignatures'),
              icon: ScanSearch,
            },
            {
              href: '#',
              label: t('knowledgeBase'),
              icon: Library,
              children: [
                {
                  href: '/knowledge',
                  label: t('knowledgeBrowser'),
                  icon: Search,
                },
                {
                  href: '/knowledge/contradictions',
                  label: t('contradictions'),
                  icon: NotebookTabs,
                },
                {
                  href: '/knowledge/admin',
                  label: t('memoryAdmin'),
                  // NOTE: Archive, not Settings — the page administers the KB's
                  // validation/forgetting (archival) lifecycle, and the gear
                  // glyph is owned by 設定.
                  icon: Archive,
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
        // NOTE: The CLI tools entry went with the /settings/cli-tools page; CLI
        // tools is a section of the settings modal (side-nav footer gear).
      ],
    },
    // NOTE: No settings item here: settings are a modal opened from the gear in
    // the side-nav footer, so a second entry in this list was redundant.
  ];

  const filteredNavItems = navItems;

  return (
    <>
      {/* z-110: above the task slide panel (z-50) and side nav (z-100) so header
          menus are never hidden behind them, but below modal dialogs (z-200). */}
      <header className="app-main-header sticky top-0 z-110 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-indigo-dark-900">
        <div className="flex items-center h-16 px-1.5 sm:px-6">
          <div className="flex shrink-0 items-center gap-1 sm:gap-2 md:gap-3">
            <button
              onClick={() => h.setIsMenuOpen(!h.isMenuOpen)}
              className="p-1.5 sm:p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label={t('openMenu')}
            >
              {h.isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>

            {/* Back/forward live here for every screen; pages no longer carry
                their own back buttons. */}
            <HistoryNavButtons />

            {/* NOTE: The desktop app (Tauri) shows no brand block — desktop apps
                rarely title their own header, and home stays reachable via the
                side nav's タスク一覧 (href="/"). Two layers, so there is neither
                a hydration mismatch nor a flash: `tauri:hidden` hides it from
                the first paint (layout.tsx's head script tags <html> with
                `tauri` before React loads), and once mounted isTauriEnv drops
                it from the DOM. Server/static HTML always includes it.
                The Web wordmark shows at every width (nav57); a 390px phone
                keeps room for the search by compacting the toolbar below md
                (header-toolbar.tsx) and this row's padding instead. */}
            {!h.isTauriEnv && (
              <Link
                href="/"
                className="flex items-center gap-2 group tauri:hidden"
                data-testid="header-brand"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                    Rapi+
                  </span>
                </div>
              </Link>
            )}
          </div>

          <HeaderSearch
            searchQuery={h.searchQuery}
            setSearchQuery={h.setSearchQuery}
            handleSearchKeyDown={h.handleSearchKeyDown}
            debounceTimerRef={h.debounceTimerRef}
          />

          <HeaderToolbar
            isMoreMenuOpen={h.isMoreMenuOpen}
            setIsMoreMenuOpen={h.setIsMoreMenuOpen}
            moreMenuRef={h.moreMenuRef}
            isDarkMode={h.isDarkMode}
            darkModeMounted={h.darkModeMounted}
            toggleTheme={h.toggleTheme}
            isTauriEnv={h.isTauriEnv}
            isRestarting={h.isRestarting}
            handleRestartClick={h.handleRestartClick}
          />
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
        user={h.user}
        isAuthLoading={!h.hasMounted || h.isAuthLoading}
        handleLogout={h.handleLogout}
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
