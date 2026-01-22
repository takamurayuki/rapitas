"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Command, Keyboard } from "lucide-react";

type ShortcutConfig = {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  description: string;
  action: () => void;
};

// カスタムイベント名
export const OPEN_SHORTCUTS_EVENT = "openKeyboardShortcuts";

export default function KeyboardShortcuts() {
  const router = useRouter();
  const [showHelp, setShowHelp] = useState(false);

  // 外部からモーダルを開くためのイベントリスナー
  useEffect(() => {
    const handleOpenShortcuts = () => setShowHelp(true);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, handleOpenShortcuts);
    return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, handleOpenShortcuts);
  }, []);

  const shortcuts: ShortcutConfig[] = [
    {
      key: "n",
      meta: true,
      description: "新規タスク作成",
      action: () => router.push("/tasks/new"),
    },
    {
      key: "d",
      meta: true,
      description: "ダッシュボード",
      action: () => router.push("/dashboard"),
    },
    {
      key: "h",
      meta: true,
      description: "ホーム（タスク一覧）",
      action: () => router.push("/"),
    },
    {
      key: "k",
      meta: true,
      description: "カンバンビュー",
      action: () => router.push("/kanban"),
    },
    {
      key: "c",
      meta: true,
      description: "カレンダー",
      action: () => router.push("/calendar"),
    },
    {
      key: "f",
      meta: true,
      shift: true,
      description: "フォーカスモード",
      action: () => router.push("/focus"),
    },
    {
      key: "/",
      meta: true,
      description: "ショートカットヘルプ",
      action: () => setShowHelp(true),
    },
    {
      key: "Escape",
      description: "閉じる",
      action: () => setShowHelp(false),
    },
  ];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 入力フィールドでは無効
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      for (const shortcut of shortcuts) {
        const metaMatch = shortcut.meta ? (e.metaKey || e.ctrlKey) : !(e.metaKey || e.ctrlKey);
        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();

        if (metaMatch && shiftMatch && keyMatch) {
          e.preventDefault();
          shortcut.action();
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  const formatShortcut = (shortcut: ShortcutConfig) => {
    const parts = [];
    if (shortcut.meta) parts.push("⌘");
    if (shortcut.shift) parts.push("⇧");
    parts.push(shortcut.key === "Escape" ? "Esc" : shortcut.key.toUpperCase());
    return parts.join(" + ");
  };

  if (!showHelp) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={() => setShowHelp(false)}
    >
      <div
        className="bg-white dark:bg-zinc-800 rounded-xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-indigo-500" />
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              キーボードショートカット
            </h2>
          </div>
          <button
            onClick={() => setShowHelp(false)}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
          {shortcuts
            .filter((s) => s.key !== "Escape")
            .map((shortcut) => (
              <div
                key={`${shortcut.key}-${shortcut.meta}-${shortcut.shift}`}
                className="flex items-center justify-between py-2"
              >
                <span className="text-sm text-zinc-700 dark:text-zinc-300">
                  {shortcut.description}
                </span>
                <kbd className="px-2 py-1 bg-zinc-100 dark:bg-zinc-700 rounded text-xs font-mono text-zinc-600 dark:text-zinc-400">
                  {formatShortcut(shortcut)}
                </kbd>
              </div>
            ))}
        </div>

        <div className="p-4 border-t border-zinc-200 dark:border-zinc-700 text-center">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            ⌘ は Mac では Command、Windows では Ctrl キー
          </p>
        </div>
      </div>
    </div>
  );
}
