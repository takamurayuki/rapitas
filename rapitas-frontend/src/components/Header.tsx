'use client';
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { useState, useEffect, useRef, type CSSProperties } from 'react';
import {
  Menu,
  Home,
  Columns3,
  List,
  Tags,
  SwatchBook,
  Search,
  X,
  FolderOpen,
  FolderKanban,
  ChevronDown,
  ChevronRight,
  Target,
  BarChart3,
  CalendarClock,
  Flame,
  Brain,
  FileText,
  Calendar,
  Clock,
  GraduationCap,
  Keyboard,
  Bot,
  CheckCircle,
  Settings,
  Github,
  GitPullRequest,
  CircleDot,
  Code,
  Key,
  Pin,
  PinOff,
  MessageSquare,
  SquareArrowDown,
  EllipsisVertical,
  Moon,
  Sun,
  BookMarked,
  RotateCw,
  Loader2,
  Sparkles,
  NotebookTabs,
  User,
  LogOut,
  Package,
  Activity,
} from 'lucide-react';
import AppIcon from '@/components/AppIcon';
import GlobalPomodoroWidget from '@/feature/tasks/pomodoro/GlobalPomodoroWidget';
import { OPEN_SHORTCUTS_EVENT } from '@/components/KeyboardShortcuts';
import NotificationBell from '@/components/NotificationBell';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useDarkMode } from '@/hooks/use-dark-mode';
import { isTauri, hideToTray } from '@/utils/tauri';
import { API_BASE_URL } from '@/utils/api';
import { useShortcutStore, type ShortcutId } from '@/stores/shortcutStore';
import { useAppModeStore, type AppMode } from '@/stores/appModeStore';
import { useNoteStore } from '@/stores/noteStore';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslations } from 'next-intl';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  children?: NavItem[];
  mode?: 'development' | 'learning';
};

type LineStyleVars = {
  '--line-duration': string;
  '--line-stagger': string;
  '--line-delay'?: string;
};

type LineStyle = CSSProperties & LineStyleVars;

const LINE_ANIMATION_DURATION = 0.22;
const LINE_STAGGER = 0.12;
const LINE_DELAY_STEP = 0.08;
const baseLineAnimationStyle: LineStyle = {
  '--line-duration': `${LINE_ANIMATION_DURATION}s`,
  '--line-stagger': `${LINE_STAGGER}s`,
};

const lineStyle = (delay: string): LineStyle => ({
  ...baseLineAnimationStyle,
  '--line-delay': delay,
});

// パスがタスク詳細ページかどうかを判定するヘルパー関数
const checkIsTaskDetailPage = (path: string | null): boolean => {
  if (!path) return false;
  return (
    (!!path.match(/^\/tasks\/[^/]+$/) && !path.endsWith('/new')) ||
    path.startsWith('/task-detail') ||
    path.startsWith('/tasks/detail')
  );
};

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hideHeader = searchParams.get('hideHeader') === 'true';
  const showHeader = searchParams.get('showHeader') === 'true';

  // タスク詳細ページではヘッダーを非表示
  // /tasks/[id], /task-detail, /tasks/detail のパターンに対応
  // ただし、showHeader=true のパラメータがある場合は表示
  // クライアントサイドでwindow.location.pathnameも確認（iframeでの読み込み時の対応）
  const [isTaskDetailPage, setIsTaskDetailPage] = useState(() =>
    checkIsTaskDetailPage(pathname),
  );

  // クライアントサイドでパスを再チェック
  useEffect(() => {
    const windowPath = window.location.pathname;
    const isDetail =
      checkIsTaskDetailPage(pathname) || checkIsTaskDetailPage(windowPath);
    setIsTaskDetailPage(isDetail);
  }, [pathname]);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMenuPinned, setIsMenuPinned] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [isTauriEnv, setIsTauriEnv] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [restartConfirmDialog, setRestartConfirmDialog] = useState<{
    open: boolean;
    activeExecutions: number;
  }>({ open: false, activeExecutions: 0 });

  const [hasMounted, setHasMounted] = useState(false);

  const { isDarkMode, mounted: darkModeMounted, toggleTheme } = useDarkMode();
  const { user, isAuthenticated, isLoading: isAuthLoading, logout } = useAuth();
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const shortcutBindings = useShortcutStore((state) => state.shortcuts);
  const appMode = useAppModeStore((state) => state.mode);
  const { modalState, openModal, closeModal } = useNoteStore();
  const t = useTranslations('nav');
  const tc = useTranslations('common');

  // ショートカットIDからラベルを取得するヘルパー
  const getShortcutLabel = (id: ShortcutId): string | undefined => {
    const binding = shortcutBindings.find((s) => s.id === id);
    if (!binding) return undefined;
    const parts: string[] = [];
    if (binding.ctrl) parts.push('Ctrl');
    if (binding.meta) parts.push('\u2318');
    if (binding.shift) parts.push('\u21E7');
    parts.push(binding.key.toUpperCase());
    return parts.join('');
  };

  // サーバー再起動を実行
  const executeRestart = async () => {
    setIsRestarting(true);
    setRestartConfirmDialog({ open: false, activeExecutions: 0 });
    setIsMoreMenuOpen(false);
    try {
      await fetch(`${API_BASE_URL}/agents/restart`, { method: 'POST' });
    } catch {
      // サーバーが停止するため接続エラーは想定内
    }
    // サーバーが再起動するまで待機してからリロード
    const waitForServer = async () => {
      const maxAttempts = 30;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const res = await fetch(`${API_BASE_URL}/agents/system-status`);
          if (res.ok) {
            window.location.reload();
            return;
          }
        } catch {
          // サーバーがまだ起動中
        }
      }
      // タイムアウトした場合もリロードを試行
      setIsRestarting(false);
      alert(t('restartTimeout'));
    };
    waitForServer();
  };

  // 再起動ボタンのクリックハンドラ
  const handleRestartClick = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/agents/system-status`);
      if (!res.ok) throw new Error('Failed to fetch system status');
      const status = await res.json();
      const activeCount =
        (status.activeExecutions || 0) + (status.runningExecutions || 0);
      if (activeCount > 0) {
        // 実行中のタスクがある場合は確認ダイアログを表示
        setRestartConfirmDialog({ open: true, activeExecutions: activeCount });
      } else {
        // 実行中のタスクがない場合は即座に再起動
        executeRestart();
      }
    } catch {
      // ステータス取得に失敗した場合は確認ダイアログなしで再起動
      executeRestart();
    }
  };

  // ログアウトハンドラ
  const handleLogout = async () => {
    setIsUserMenuOpen(false);
    await logout();
    router.push('/auth/login');
  };

  // ハイドレーション後にマウント済みフラグをセット（認証UIのハイドレーションミスマッチ防止）
  useEffect(() => {
    setHasMounted(true);
  }, []);

  // Tauri環境かどうかを判定
  useEffect(() => {
    setIsTauriEnv(isTauri());
  }, []);
  const menuRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isUpdatingSearchRef = useRef(false); // プログラム的更新をトラック

  // ピン止め状態をlocalStorageから復元
  useEffect(() => {
    const savedPinned = localStorage.getItem('menuPinned');
    if (savedPinned === 'true') {
      setIsMenuPinned(true);
      setIsMenuOpen(true);
    }
  }, []);

  // ピン止め状態をlocalStorageに保存
  useEffect(() => {
    localStorage.setItem('menuPinned', isMenuPinned.toString());
  }, [isMenuPinned]);

  // 検索のデバウンス処理
  useEffect(() => {
    // 前回のタイマーをクリア
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // ホーム・カンバンページではインラインフィルタリングも維持
    if (pathname === '/' || pathname === '/kanban') {
      debounceTimerRef.current = setTimeout(() => {
        isUpdatingSearchRef.current = true; // プログラム的更新をマーク
        if (searchQuery.trim()) {
          router.push(`/?search=${encodeURIComponent(searchQuery.trim())}`);
        } else {
          const currentSearch = searchParams.get('search');
          if (currentSearch) {
            router.push(pathname);
          }
        }
      }, 300);
    }

    // クリーンアップ
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery, pathname, router]); // searchParamsを依存配列から除去 - 循環更新を防ぐ

  // URLの検索パラメータから初期値を設定（外部変更時のみ）
  useEffect(() => {
    // プログラム的更新中は同期しない
    if (isUpdatingSearchRef.current) {
      isUpdatingSearchRef.current = false;
      return;
    }

    if (pathname === '/search') {
      const q = searchParams.get('q');
      if (q && searchQuery !== q) {
        setSearchQuery(q);
      }
    } else {
      const search = searchParams.get('search');
      if (search && searchQuery !== search) {
        setSearchQuery(search);
      }
    }
  }, [searchParams, pathname]); // 循環更新防止ガード追加

  // Enterキーで検索結果ページに遷移
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      isUpdatingSearchRef.current = true; // プログラム的更新をマーク
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  // メニュー外をクリックしたら閉じる（固定時は閉じない）
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        !isMenuPinned
      ) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen, isMenuPinned]);

  // 三点リーダーメニュー外をクリックしたら閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(event.target as Node)
      ) {
        setIsMoreMenuOpen(false);
      }
    };

    if (isMoreMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMoreMenuOpen]);

  // ユーザーメニュー外をクリックしたら閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(event.target as Node)
      ) {
        setIsUserMenuOpen(false);
      }
    };

    if (isUserMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isUserMenuOpen]);

  // showHeader=true の場合はタスク詳細ページでもヘッダーを表示
  if (hideHeader || (isTaskDetailPage && !showHeader)) {
    return null;
  }

  const navItems: NavItem[] = [
    {
      href: '/',
      label: t('taskList'),
      icon: Home,
      shortcut: getShortcutLabel('home'),
      children: [
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
            {
              href: '/themes',
              label: t('themeList'),
              icon: SwatchBook,
            },
            {
              href: '/labels',
              label: t('labelList'),
              icon: Tags,
            },
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
      href: '/dashboard',
      label: t('dashboard'),
      icon: BarChart3,
      shortcut: getShortcutLabel('dashboard'),
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
        {
          href: '/exam-goals',
          label: t('examGoals'),
          icon: Target,
        },
        {
          href: '/flashcards',
          label: t('flashcards'),
          icon: Brain,
        },
      ],
    },
    {
      href: '#',
      label: t('habitsAchievements'),
      icon: CalendarClock,
      children: [
        {
          href: '/calendar',
          label: t('calendar'),
          icon: Calendar,
          shortcut: getShortcutLabel('calendar'),
        },
        {
          href: '/habits',
          label: t('habitTracker'),
          icon: Flame,
        },
        {
          href: '/habits/daily-schedule',
          label: t('dailySchedule'),
          icon: Clock,
        },
        {
          href: '/reports',
          label: t('weeklyReport'),
          icon: FileText,
        },
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
          icon: Github,
          children: [
            {
              href: '/github',
              label: t('devDashboard'),
              icon: BarChart3,
            },
            {
              href: '/github/pull-requests',
              label: 'Pull Requests',
              icon: GitPullRequest,
            },
            {
              href: '/github/issues',
              label: 'Issues',
              icon: CircleDot,
            },
          ],
        },
        {
          href: '#',
          label: t('agent'),
          icon: Bot,
          children: [
            {
              href: '/agents',
              label: t('agentManagement'),
              icon: Settings,
            },
            {
              href: '/agents/metrics',
              label: t('metrics'),
              icon: BarChart3,
            },
            {
              href: '/agents/versions',
              label: t('versionControl'),
              icon: Package,
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
          href: '/orchestra',
          label: t('orchestra'),
          icon: Activity,
        },
        {
          href: '/approvals',
          label: t('approvals'),
          icon: CheckCircle,
        },
        {
          href: '/system-prompts',
          label: t('promptManagement'),
          icon: MessageSquare,
        },
        {
          href: '/claude-md-generator',
          label: t('claudeGeneration'),
          icon: Sparkles,
        },
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
        {
          href: '/settings',
          label: t('apiKeySettings'),
          icon: Key,
        },
        {
          href: '/settings/cli-tools',
          label: t('cliTools'),
          icon: Package,
        },
        {
          href: '/settings/shortcuts',
          label: t('shortcutSettings'),
          icon: Keyboard,
        },
      ],
    },
  ];

  const filterNavItems = (
    items: NavItem[],
    currentMode: AppMode,
  ): NavItem[] => {
    if (currentMode === 'all') return items;
    return items.filter((item) => {
      if (!item.mode) return true;
      return item.mode === currentMode;
    });
  };

  const filteredNavItems = filterNavItems(navItems, appMode);

  const toggleExpand = (label: string) => {
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(label)) {
        newSet.delete(label);
      } else {
        newSet.add(label);
      }
      return newSet;
    });
  };

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/' || pathname === '/kanban';
    if (href === '#') return false;
    // 完全一致のみをアクティブとする
    // 子要素がアクティブな場合は isChildActive で別途ハイライトされるため、
    // ここでは完全一致のみを判定することで、複数項目が同時に選択される問題を防ぐ
    return pathname === href;
  };

  // 再帰的に子要素がアクティブかチェック
  const isChildActive = (item: NavItem): boolean => {
    if (!item.children) return false;
    return item.children.some((child) => {
      if (isActive(child.href)) return true;
      return isChildActive(child);
    });
  };

  const isListView = pathname === '/' || !pathname?.startsWith('/kanban');

  const toggleView = () => {
    if (isListView) {
      router.push('/kanban');
    } else {
      router.push('/');
    }
  };

  // 線を描くアニメーション用の遅延時間（深さと並び順で少しずらす）
  const getLineDelay = (depth: number, order: number) =>
    `${((depth + order) * LINE_DELAY_STEP).toFixed(3)}s`;

  // 再帰的にナビゲーション項目をレンダリング
  const renderNavItem = (
    item: NavItem,
    depth: number,
    parentExpanded = true,
  ): React.ReactNode => {
    const Icon = item.icon;
    const active = isActive(item.href);
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.has(item.label);
    const childActive = isChildActive(item);
    const hasValidLink = item.href !== '#';

    // トップレベル（depth === 0）
    if (depth === 0) {
      if (hasChildren) {
        return (
          <div key={item.label}>
            {hasValidLink ? (
              /* リンクと展開ボタンの両方を持つ項目 */
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
              /* 展開のみの項目（リンクなし） */
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
                      {/* 縦線 */}
                      <div
                        className={`absolute left-0 top-0 w-px bg-zinc-300 dark:bg-zinc-600 ${isLastChild ? 'h-5' : 'h-full'} ${
                          isExpanded ? 'line-animate-vertical' : ''
                        }`}
                        style={lineStyle(getLineDelay(depth, index))}
                      />
                      {renderNavItem(child, depth + 1, isExpanded)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      }

      // 子要素なしのトップレベル項目
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

    // ネストされた項目（depth > 0）
    if (hasChildren) {
      return (
        <div key={item.label}>
          {/* アイテム本体（固定高さ） */}
          <div className="relative h-10 flex items-center">
            <div
              className={`absolute left-0 top-1/2 w-4 h-px bg-zinc-300 dark:bg-zinc-600 ${
                parentExpanded ? 'line-animate-horizontal' : ''
              }`}
              style={lineStyle(getLineDelay(depth, 0))}
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
          {/* 展開されたコンテンツ（本体とは別） */}
          {isExpanded && (
            <div className="ml-10">
              {item.children!.map((child, index) => {
                const isLastChild = index === item.children!.length - 1;
                return (
                  <div key={child.label} className="relative">
                    {/* 縦線 */}
                    <div
                      className={`absolute left-0 top-0 w-px bg-zinc-300 dark:bg-zinc-600 ${isLastChild ? 'h-5' : 'h-full'} ${
                        parentExpanded ? 'line-animate-vertical' : ''
                      }`}
                      style={lineStyle(getLineDelay(depth, index))}
                    />
                    {renderNavItem(
                      child,
                      depth + 1,
                      isExpanded && parentExpanded,
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    // ネストされたリンク項目（子要素なし）
    return (
      <div key={item.href} className="relative h-10 flex items-center">
        <div
          className={`absolute left-0 top-1/2 w-4 h-px bg-zinc-300 dark:bg-zinc-600 ${
            parentExpanded ? 'line-animate-horizontal' : ''
          }`}
          style={lineStyle(getLineDelay(depth, 0))}
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
  };

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-indigo-dark-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              {/* ハンバーガーメニューボタン */}
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                aria-label={t('openMenu')}
              >
                {isMenuOpen ? (
                  <X className="w-6 h-6" />
                ) : (
                  <Menu className="w-6 h-6" />
                )}
              </button>

              {/* ロゴ */}
              <Link href="/" className="flex items-center gap-2 group">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-8 h-8 bg-indigo-400 rounded-lg shadow-md">
                    <AppIcon size={20} className="text-white" />
                  </div>
                  <span className="text-lg font-bold bg-indigo-400 bg-clip-text text-transparent">
                    Rapi+
                  </span>
                </div>
              </Link>
            </div>

            {/* 検索バー（全ページで表示） */}
            <div className="flex-1 max-w-md mx-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={t('searchPlaceholder')}
                  className="w-full pl-10 pr-4 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-zinc-400 dark:placeholder-zinc-500 transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => {
                      if (debounceTimerRef.current) {
                        clearTimeout(debounceTimerRef.current);
                      }
                      setSearchQuery('');
                      if (pathname === '/search') {
                        router.push('/search');
                      } else if (pathname === '/kanban') {
                        router.push('/kanban');
                      } else if (pathname === '/') {
                        router.push('/');
                      }
                    }}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* 表示切り替えボタン（タスク一覧/カンバンページのみ表示） */}
            <div className="flex items-center gap-3">
              {/* ポモドーロタイマー表示（タスク詳細ページでは非表示） */}
              {!pathname?.startsWith('/tasks/') && <GlobalPomodoroWidget />}

              {(pathname === '/' || pathname === '/kanban') && (
                <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1">
                  <button
                    onClick={() => isListView || toggleView()}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                      isListView
                        ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50 shadow-sm'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50'
                    }`}
                  >
                    <List className="w-4 h-4" />
                    <span>{t('list')}</span>
                  </button>
                  <button
                    onClick={() => !isListView || toggleView()}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                      !isListView
                        ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50 shadow-sm'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50'
                    }`}
                  >
                    <Columns3 className="w-4 h-4" />
                    <span>{t('kanban')}</span>
                  </button>
                </div>
              )}

              {/* 言語切替 */}
              <LanguageSwitcher />

              {/* 通知ベル */}
              <NotificationBell />

              {/* ユーザーメニュー（認証時のみ表示、hasMountedでハイドレーションミスマッチ防止） */}
              {hasMounted && !isAuthLoading && isAuthenticated && user && (
                <div className="relative" ref={userMenuRef}>
                  <button
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    aria-label={t('userMenu')}
                    title={t('userMenuTitle', { username: user.username })}
                  >
                    <User className="w-5 h-5" />
                  </button>
                  {isUserMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 z-50">
                      {/* ユーザー情報 */}
                      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {user.username}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {user.email}
                        </p>
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                          {user.role === 'admin' ? t('admin') : t('user')}
                        </p>
                      </div>
                      {/* ログアウト */}
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>{t('logout')}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 三点リーダーメニュー */}
              <div className="relative" ref={moreMenuRef}>
                <button
                  onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                  className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  aria-label={t('moreMenu')}
                  title={t('moreMenu')}
                >
                  <EllipsisVertical className="w-5 h-5" />
                </button>
                {isMoreMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 z-50">
                    {/* ノート・AI */}
                    <button
                      onClick={() => {
                        if (modalState.isOpen) {
                          closeModal();
                        } else {
                          openModal();
                        }
                        setIsMoreMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                    >
                      {modalState.activeTab === 'ai' ? (
                        <Sparkles className="w-4 h-4" />
                      ) : (
                        <NotebookTabs className="w-4 h-4" />
                      )}
                      <span>
                        {modalState.isOpen
                          ? t('closeNoteAI')
                          : t('openNoteAI')}
                      </span>
                    </button>
                    {/* ダークモード切り替え */}
                    <button
                      onClick={() => {
                        toggleTheme();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                    >
                      {darkModeMounted && isDarkMode ? (
                        <Sun className="w-4 h-4" />
                      ) : (
                        <Moon className="w-4 h-4" />
                      )}
                      <span>
                        {darkModeMounted && isDarkMode
                          ? t('switchToLight')
                          : t('switchToDark')}
                      </span>
                    </button>
                    {/* 全体設定 */}
                    <Link
                      href="/settings/general"
                      onClick={() => setIsMoreMenuOpen(false)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                    >
                      <Settings className="w-4 h-4" />
                      <span>{t('generalSettings')}</span>
                    </Link>
                    {/* トレイ格納ボタン（Tauri環境のみ表示） */}
                    {isTauriEnv && (
                      <button
                        onClick={() => {
                          hideToTray();
                          setIsMoreMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                      >
                        <SquareArrowDown className="w-4 h-4" />
                        <span>{t('minimizeToTray')}</span>
                      </button>
                    )}
                    {/* 区切り線 */}
                    <div className="my-1 border-t border-zinc-200 dark:border-zinc-700" />
                    {/* サーバー再起動 */}
                    <button
                      onClick={handleRestartClick}
                      disabled={isRestarting}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isRestarting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RotateCw className="w-4 h-4" />
                      )}
                      <span>
                        {isRestarting ? t('restarting') : t('restartServer')}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* サイドバーメニュー */}
      <nav
        ref={menuRef}
        className={`fixed left-0 top-0 h-full w-72 bg-white dark:bg-indigo-dark-900 shadow-2xl z-100 transform transition-transform duration-300 ${
          isMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* ヘッダー */}
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
            aria-label={
              isMenuPinned ? t('unpinMenu') : t('pinMenu')
            }
            title={isMenuPinned ? t('unpinMenu') : t('pinMenu')}
          >
            {isMenuPinned ? (
              <PinOff className="w-5 h-5" />
            ) : (
              <Pin className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* ナビゲーション項目 */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          <div className="p-4 space-y-1 flex-1">
            {filteredNavItems.map((item) => renderNavItem(item, 0))}
          </div>

          {/* ショートカットヘルプ */}
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

      {/* 再起動確認ダイアログ */}
      {restartConfirmDialog.open && (
        <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-zinc-800 rounded-xl shadow-2xl p-6 max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
              {t('restartConfirm')}
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                {restartConfirmDialog.activeExecutions}{t('tasksUnit')}
              </span>{' '}
              {t('restartWarning')}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() =>
                  setRestartConfirmDialog({ open: false, activeExecutions: 0 })
                }
                className="px-4 py-2 text-sm rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              >
                {tc('cancel')}
              </button>
              <button
                onClick={executeRestart}
                className="px-4 py-2 text-sm rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors"
              >
                {t('restart')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 再起動中オーバーレイ */}
      {isRestarting && (
        <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-zinc-800 rounded-xl shadow-2xl p-8 flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('restartingOverlay')}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t('restartingMessage')}
            </p>
          </div>
        </div>
      )}

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
          animation: draw-horizontal var(--line-duration, 0.22s) ease-out
            forwards;
          animation-delay: calc(
            var(--line-delay, 0s) + var(--line-stagger, 0.12s)
          );
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
