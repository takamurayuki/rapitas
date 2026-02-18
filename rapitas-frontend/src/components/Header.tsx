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
  Trophy,
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
} from 'lucide-react';
import AppIcon from '@/components/AppIcon';
import GlobalPomodoroWidget from '@/feature/tasks/pomodoro/GlobalPomodoroWidget';
import { OPEN_SHORTCUTS_EVENT } from '@/components/KeyboardShortcuts';
import NotificationBell from '@/components/NotificationBell';
import { useDarkMode } from '@/hooks/use-dark-mode';
import { isTauri, hideToTray } from '@/utils/tauri';
import { API_BASE_URL } from '@/utils/api';
import { useShortcutStore, type ShortcutId } from '@/stores/shortcutStore';
import { useAppModeStore, type AppMode } from '@/stores/appModeStore';
import { useNoteStore } from '@/stores/noteStore';

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
  const [isRestarting, setIsRestarting] = useState(false);
  const [restartConfirmDialog, setRestartConfirmDialog] = useState<{
    open: boolean;
    activeExecutions: number;
  }>({ open: false, activeExecutions: 0 });

  const { isDarkMode, mounted: darkModeMounted, toggleTheme } = useDarkMode();
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const shortcutBindings = useShortcutStore((state) => state.shortcuts);
  const appMode = useAppModeStore((state) => state.mode);
  const { modalState, openModal, closeModal } = useNoteStore();

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
      alert(
        'サーバーの再起動がタイムアウトしました。手動でページをリロードしてください。',
      );
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

  // Tauri環境かどうかを判定
  useEffect(() => {
    setIsTauriEnv(isTauri());
  }, []);
  const menuRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

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

    // 300ms後にURLを更新
    debounceTimerRef.current = setTimeout(() => {
      if (searchQuery.trim()) {
        router.push(`/?search=${encodeURIComponent(searchQuery.trim())}`);
      } else if (pathname === '/' || pathname === '/kanban') {
        // 検索クエリが空で、タスクページにいる場合のみクリア
        const currentSearch = searchParams.get('search');
        if (currentSearch) {
          router.push(pathname);
        }
      }
    }, 300);

    // クリーンアップ
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery, pathname, router, searchParams]);

  // URLの検索パラメータから初期値を設定
  useEffect(() => {
    const search = searchParams.get('search');
    if (search && searchQuery !== search) {
      setSearchQuery(search);
    }
  }, [searchParams]);

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

  // showHeader=true の場合はタスク詳細ページでもヘッダーを表示
  if (hideHeader || (isTaskDetailPage && !showHeader)) {
    return null;
  }

  const navItems: NavItem[] = [
    {
      href: '/',
      label: 'タスク一覧',
      icon: Home,
      shortcut: getShortcutLabel('home'),
      children: [
        {
          href: '#',
          label: 'カテゴリ',
          icon: FolderOpen,
          children: [
            {
              href: '/categories',
              label: 'カテゴリ一覧',
              icon: FolderKanban,
            },
            {
              href: '/themes',
              label: 'テーマ一覧',
              icon: SwatchBook,
            },
            {
              href: '/labels',
              label: 'ラベル一覧',
              icon: Tags,
            },
          ],
        },
        {
          href: '/settings/developer-mode',
          label: 'タスク設定',
          icon: Settings,
        },
      ],
    },
    {
      href: '/dashboard',
      label: 'ダッシュボード',
      icon: BarChart3,
      shortcut: getShortcutLabel('dashboard'),
    },
    {
      href: '/calendar',
      label: 'カレンダー',
      icon: Calendar,
      shortcut: getShortcutLabel('calendar'),
    },
    {
      href: '#',
      label: '学習',
      icon: GraduationCap,
      mode: 'learning',
      children: [
        {
          href: '/learning-goals',
          label: '学習目標',
          icon: BookMarked,
        },
        {
          href: '/exam-goals',
          label: '試験目標',
          icon: Target,
        },
        {
          href: '/flashcards',
          label: 'フラッシュカード',
          icon: Brain,
        },
      ],
    },
    {
      href: '#',
      label: '習慣・実績',
      icon: Trophy,
      children: [
        {
          href: '/habits',
          label: '習慣トラッカー',
          icon: Flame,
        },
        {
          href: '/habits/daily-schedule',
          label: '一日のスケジュール',
          icon: Clock,
        },
        {
          href: '/achievements',
          label: '実績・バッジ',
          icon: Trophy,
        },
        {
          href: '/reports',
          label: '週次レポート',
          icon: FileText,
        },
      ],
    },
    {
      href: '#',
      label: '開発',
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
              label: 'ダッシュボード',
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
          href: '/agents',
          label: 'エージェント管理',
          icon: Bot,
        },
        {
          href: '/approvals',
          label: '承認待ち',
          icon: CheckCircle,
        },
        {
          href: '/system-prompts',
          label: 'プロンプト管理',
          icon: MessageSquare,
        },
      ],
    },
    {
      href: '/settings/general',
      label: '全体設定',
      icon: Settings,
    },
    {
      href: '/settings',
      label: 'APIキー設定',
      icon: Key,
    },
    {
      href: '/settings/shortcuts',
      label: 'ショートカット設定',
      icon: Keyboard,
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
                aria-label="メニューを開く"
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

            {/* 検索バー（タスク一覧ページでのみ表示） */}
            {(pathname === '/' || pathname === '/kanban') && (
              <div className="flex-1 max-w-md mx-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="タスクを検索..."
                    className="w-full pl-10 pr-4 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-zinc-400 dark:placeholder-zinc-500 transition-all"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => {
                        // デバウンスタイマーをクリアして即座にリセット
                        if (debounceTimerRef.current) {
                          clearTimeout(debounceTimerRef.current);
                        }
                        setSearchQuery('');
                        router.push(pathname === '/kanban' ? '/kanban' : '/');
                      }}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 検索バーがない場合のスペーサー */}
            {pathname !== '/' && pathname !== '/kanban' && (
              <div className="flex-1" />
            )}

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
                    <span>リスト</span>
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
                    <span>カンバン</span>
                  </button>
                </div>
              )}

              {/* 通知ベル */}
              <NotificationBell />

              {/* ノート・AIモーダルボタン */}
              <button
                onClick={() => {
                  if (modalState.isOpen) {
                    closeModal();
                  } else {
                    openModal();
                  }
                }}
                className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors relative"
                title={
                  modalState.isOpen
                    ? 'ノート・AIを閉じる'
                    : 'ノート・AIを開く (Ctrl+E)'
                }
              >
                {modalState.activeTab === 'ai' ? (
                  <Sparkles className="w-5 h-5" />
                ) : (
                  <NotebookTabs className="w-5 h-5" />
                )}
                {modalState.isOpen && (
                  <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-1 h-1 bg-indigo-500 rounded-full" />
                )}
              </button>

              {/* 三点リーダーメニュー */}
              <div className="relative" ref={moreMenuRef}>
                <button
                  onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                  className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  aria-label="その他のメニュー"
                  title="その他のメニュー"
                >
                  <EllipsisVertical className="w-5 h-5" />
                </button>
                {isMoreMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 z-50">
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
                          ? 'ライトモードに切替'
                          : 'ダークモードに切替'}
                      </span>
                    </button>
                    {/* 全体設定 */}
                    <Link
                      href="/settings/general"
                      onClick={() => setIsMoreMenuOpen(false)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                    >
                      <Settings className="w-4 h-4" />
                      <span>全体設定</span>
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
                        <span>タスクトレイに格納</span>
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
                        {isRestarting ? '再起動中...' : 'サーバー再起動'}
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
              isMenuPinned ? 'メニューの固定を解除' : 'メニューを固定'
            }
            title={isMenuPinned ? 'メニューの固定を解除' : 'メニューを固定'}
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
                <span className="text-sm">キーボードショートカット</span>
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
              サーバーを再起動しますか？
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              現在{' '}
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                {restartConfirmDialog.activeExecutions}件
              </span>{' '}
              のタスクが実行中です。再起動すると実行中のタスクは中断されます。
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() =>
                  setRestartConfirmDialog({ open: false, activeExecutions: 0 })
                }
                className="px-4 py-2 text-sm rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={executeRestart}
                className="px-4 py-2 text-sm rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors"
              >
                再起動する
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
              サーバーを再起動しています...
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              完了後に自動でページがリロードされます
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
