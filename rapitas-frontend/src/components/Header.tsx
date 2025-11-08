"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* ロゴ */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 group-hover:from-blue-600 group-hover:to-purple-700 transition-all">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Rapitas
            </span>
          </Link>

          {/* ナビゲーション */}
          <nav className="flex items-center gap-1">
            <Link
              href="/"
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                pathname === "/"
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-50"
              }`}
            >
              タスク一覧
            </Link>
            <Link
              href="/kanban"
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                pathname === "/kanban"
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-50"
              }`}
            >
              カンバン
            </Link>
          </nav>

          {/* アクション */}
          <div className="flex items-center gap-3">
            <Link
              href="/tasks/new"
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              新しいタスク
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
