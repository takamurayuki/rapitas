"use client";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import {
  Menu,
  Home,
  Columns3,
  List,
  Tags,
  Palette,
  Search,
  X,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Target,
  BarChart3,
  Sparkles,
  Trophy,
  Flame,
  Brain,
  FileText,
  Calendar,
  Keyboard,
  Command,
} from "lucide-react";
import AppIcon from "@/components/app-icon";
import GlobalPomodoroWidget from "@/feature/tasks/pomodoro/GlobalPomodoroWidget";
import { OPEN_SHORTCUTS_EVENT } from "@/components/keyboard-shortcuts";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  children?: NavItem[];
};

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hideHeader = searchParams.get("hideHeader") === "true";
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // メニュー外をクリックしたら閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isMenuOpen]);

  if (hideHeader) {
    return null;
  }

  const navItems: NavItem[] = [
    {
      href: "/",
      label: "タスク一覧",
      icon: Home,
      shortcut: "⌘H",
    },
    {
      href: "/dashboard",
      label: "ダッシュボード",
      icon: BarChart3,
      shortcut: "⌘D",
    },
    {
      href: "/calendar",
      label: "カレンダー",
      icon: Calendar,
      shortcut: "⌘C",
    },
    {
      href: "#",
      label: "学習",
      icon: Sparkles,
      children: [
        {
          href: "/exam-goals",
          label: "試験目標",
          icon: Target,
        },
        {
          href: "/study-plans",
          label: "AI学習計画",
          icon: Sparkles,
        },
        {
          href: "/flashcards",
          label: "フラッシュカード",
          icon: Brain,
        },
      ],
    },
    {
      href: "#",
      label: "習慣・実績",
      icon: Trophy,
      children: [
        {
          href: "/habits",
          label: "習慣トラッカー",
          icon: Flame,
        },
        {
          href: "/achievements",
          label: "実績・バッジ",
          icon: Trophy,
        },
        {
          href: "/reports",
          label: "週次レポート",
          icon: FileText,
        },
      ],
    },
    {
      href: "#",
      label: "カテゴリ",
      icon: FolderOpen,
      children: [
        {
          href: "/themes",
          label: "テーマ一覧",
          icon: Palette,
        },
        {
          href: "/labels",
          label: "ラベル一覧",
          icon: Tags,
        },
      ],
    },
  ];

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

  const isChildActive = (item: NavItem) => {
    if (!item.children) return false;
    return item.children.some((child) => isActive(child.href));
  };

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/" || pathname === "/kanban";
    return pathname?.startsWith(href);
  };

  const isListView = pathname === "/" || !pathname?.startsWith("/kanban");

  const toggleView = () => {
    if (isListView) {
      router.push("/kanban");
    } else {
      router.push("/");
    }
  };

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-zinc-200 dark:border-zinc-800 backdrop-blur-lg">
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
            {(pathname === "/" || pathname === "/kanban") && (
              <div className="flex-1 max-w-md mx-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      const value = e.target.value;
                      setSearchQuery(value);
                      if (value.trim()) {
                        router.push(
                          `/?search=${encodeURIComponent(value.trim())}`,
                        );
                      } else {
                        router.push("/");
                      }
                    }}
                    placeholder="タスクを検索..."
                    className="w-full pl-10 pr-4 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-zinc-400 dark:placeholder-zinc-500 transition-all"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => {
                        setSearchQuery("");
                        router.push("/");
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
            {pathname !== "/" && pathname !== "/kanban" && (
              <div className="flex-1" />
            )}

            {/* 表示切り替えボタン（タスク一覧/カンバンページのみ表示） */}
            <div className="flex items-center gap-3">
              {/* ポモドーロタイマー表示（タスク詳細ページでは非表示） */}
              {!pathname?.startsWith("/tasks/") && <GlobalPomodoroWidget />}

              {(pathname === "/" || pathname === "/kanban") && (
                <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1">
                  <button
                    onClick={() => isListView || toggleView()}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                      isListView
                        ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50 shadow-sm"
                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50"
                    }`}
                  >
                    <List className="w-4 h-4" />
                    <span>リスト</span>
                  </button>
                  <button
                    onClick={() => !isListView || toggleView()}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                      !isListView
                        ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50 shadow-sm"
                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50"
                    }`}
                  >
                    <Columns3 className="w-4 h-4" />
                    <span>カンバン</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* サイドバーメニュー */}
      <nav
        ref={menuRef}
        className={`fixed left-0 top-0 h-full w-72 bg-white dark:bg-zinc-900 shadow-2xl z-100 transform transition-transform duration-300 ${
          isMenuOpen ? "translate-x-0" : "-translate-x-full"
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
        </div>

        {/* ナビゲーション項目 */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          <div className="p-4 space-y-1 flex-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              const hasChildren = item.children && item.children.length > 0;
              const isExpanded = expandedItems.has(item.label);
              const childActive = isChildActive(item);

              if (hasChildren) {
                return (
                  <div key={item.label}>
                    <button
                      onClick={() => toggleExpand(item.label)}
                      className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg transition-all ${
                        childActive
                          ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300"
                          : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
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
                    {isExpanded && (
                      <div className="relative ml-7">
                        {/* 縦線（全体を通る） */}
                        <div
                          className="absolute left-0 top-0 w-px bg-zinc-300 dark:bg-zinc-600"
                          style={{ height: `calc(100% - 20px)` }}
                        />
                        {item.children!.map((child, index) => {
                          const ChildIcon = child.icon;
                          const childIsActive = isActive(child.href);
                          const isLast = index === item.children!.length - 1;
                          return (
                            <div
                              key={child.href}
                              className="relative flex items-center py-1"
                            >
                              {/* 横線 */}
                              <div className="absolute left-0 top-1/2 w-4 h-px bg-zinc-300 dark:bg-zinc-600" />
                              {/* リンク */}
                              <Link
                                href={child.href}
                                onClick={() => setIsMenuOpen(false)}
                                className={`ml-5 flex-1 flex items-center gap-2.5 px-3 py-2 rounded-md transition-all ${
                                  childIsActive
                                    ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-semibold border-l-2 border-indigo-500"
                                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                }`}
                              >
                                <ChildIcon
                                  className={`w-4 h-4 shrink-0 ${childIsActive ? "text-indigo-600 dark:text-indigo-400" : ""}`}
                                />
                                <span className="text-sm">{child.label}</span>
                              </Link>
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
                  onClick={() => setIsMenuOpen(false)}
                  className={`flex items-center justify-between gap-3 px-4 py-3 rounded-md transition-all ${
                    active
                      ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-semibold border-l-2 border-indigo-500"
                      : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      className={`w-5 h-5 shrink-0 ${active ? "text-indigo-600 dark:text-indigo-400" : ""}`}
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
            })}
          </div>

          {/* ショートカットヘルプ */}
          <div className="p-4 border-t border-zinc-200 dark:border-zinc-800">
            <button
              onClick={() => {
                setIsMenuOpen(false);
                window.dispatchEvent(new CustomEvent(OPEN_SHORTCUTS_EVENT));
              }}
              className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-3">
                <Keyboard className="w-4 h-4" />
                <span className="text-sm">キーボードショートカット</span>
              </div>
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700">
                ⌘/
              </kbd>
            </button>
          </div>
        </div>
      </nav>
    </>
  );
}
