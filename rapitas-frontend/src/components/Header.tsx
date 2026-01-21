"use client";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import {
  Menu,
  X,
  Home,
  Columns3,
  FolderKanban,
  Plus,
  ChevronDown,
  ChevronRight,
  List,
  Folder,
  Tag,
  Check,
  XIcon,
  Search,
} from "lucide-react";
import AppIcon from "@/components/app-icon";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: NavItem[];
};

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hideHeader = searchParams.get("hideHeader") === "true";
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
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
    },
    {
      href: "/themes",
      label: "テーマ一覧",
      icon: Tag,
    },
  ];

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/" || pathname === "/kanban";
    return pathname?.startsWith(href);
  };

  // const toggleExpand = (label: string) => {
  //   setExpandedItems((prev) => {
  //     const newSet = new Set(prev);
  //     if (newSet.has(label)) {
  //       newSet.delete(label);
  //     } else {
  //       newSet.add(label);
  //     }
  //     return newSet;
  //   });
  // };

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
                onClick={() => setIsMenuOpen(true)}
                className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                aria-label="メニューを開く"
              >
                <Menu className="w-6 h-6" />
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

            {/* 検索バー */}
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

            {/* 表示切り替えボタン（タスク一覧/カンバンページのみ表示） */}
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
          <button
            onClick={() => setIsMenuOpen(false)}
            className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="メニューを閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ナビゲーション項目 */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                    active
                      ? "bg-linear-to-r from-indigo-500 to-purple-600 text-white shadow-md"
                      : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}
