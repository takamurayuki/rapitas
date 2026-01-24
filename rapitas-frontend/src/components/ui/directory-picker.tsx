"use client";

import { useState, useEffect } from "react";
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronLeft,
  Home,
  HardDrive,
  X,
  Check,
  ArrowUp,
  GitBranch,
  Loader2,
  Monitor,
} from "lucide-react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

type DirectoryEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
};

type BrowseResult = {
  path: string;
  parent: string | null;
  directories: DirectoryEntry[];
  isGitRepo?: boolean;
  error?: string;
  isDriveList?: boolean;
};

type DirectoryPickerProps = {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  className?: string;
};

export function DirectoryPicker({
  value,
  onChange,
  placeholder = "ディレクトリパスを入力または選択",
  className = "",
}: DirectoryPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [isDriveList, setIsDriveList] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualPath, setManualPath] = useState("");

  const browseDirectory = async (path?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const url = path
        ? `${API_BASE_URL}/directories/browse?path=${encodeURIComponent(path)}`
        : `${API_BASE_URL}/directories/browse`;

      const res = await fetch(url);
      const data: BrowseResult = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      setCurrentPath(data.path);
      setDirectories(data.directories);
      setParentPath(data.parent);
      setIsGitRepo(data.isGitRepo || false);
      setIsDriveList(data.isDriveList || false);
    } catch (err: any) {
      setError(err.message || "ディレクトリの取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpen = () => {
    setIsOpen(true);
    setManualPath("");
    // 現在の値がある場合はそのディレクトリを開く、なければドライブ一覧から開始
    if (value) {
      browseDirectory(value);
    } else {
      browseDirectory(); // ドライブ一覧を表示
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setError(null);
    setManualPath("");
  };

  const handleSelect = () => {
    if (currentPath) {
      onChange(currentPath);
      handleClose();
    }
  };

  const handleNavigate = (path: string) => {
    browseDirectory(path);
  };

  const handleGoUp = () => {
    if (parentPath) {
      browseDirectory(parentPath);
    } else if (currentPath) {
      // 親がない場合はドライブ一覧に戻る
      browseDirectory();
    }
  };

  const handleGoToDrives = () => {
    browseDirectory(); // ドライブ一覧を表示
  };

  const handleGoToPath = () => {
    if (manualPath.trim()) {
      browseDirectory(manualPath.trim());
    }
  };

  return (
    <div className={`relative ${className}`}>
      {/* Input with Browse Button */}
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all font-mono text-xs"
        />
        <button
          type="button"
          onClick={handleOpen}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-all text-sm font-medium shrink-0"
          title="フォルダを選択"
        >
          <FolderOpen className="w-4 h-4" />
          参照
        </button>
      </div>

      {/* Directory Browser Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
              <div className="flex items-center gap-3">
                <Folder className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                  ディレクトリを選択
                </span>
              </div>
              <button
                onClick={handleClose}
                className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-md transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation Bar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-zinc-700">
              <button
                onClick={handleGoUp}
                disabled={isLoading}
                className="p-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="上のフォルダへ"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
              <button
                onClick={handleGoToDrives}
                disabled={isLoading}
                className="p-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50"
                title="ドライブ一覧"
              >
                <Monitor className="w-4 h-4" />
              </button>
              <div className="flex-1 flex items-center gap-1 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg overflow-x-auto">
                <HardDrive className="w-4 h-4 text-zinc-400 shrink-0" />
                <span className="text-sm font-mono text-zinc-700 dark:text-zinc-300 truncate">
                  {currentPath || "ドライブ一覧"}
                </span>
                {isGitRepo && (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded text-xs font-medium shrink-0">
                    <GitBranch className="w-3 h-3" />
                    Git
                  </span>
                )}
              </div>
            </div>

            {/* Manual Path Input */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
              <input
                type="text"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleGoToPath();
                  }
                }}
                placeholder="パスを直接入力 (例: C:\Projects, D:\)"
                className="flex-1 px-3 py-1.5 text-sm font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
              />
              <button
                onClick={handleGoToPath}
                disabled={!manualPath.trim() || isLoading}
                className="px-3 py-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                移動
              </button>
            </div>

            {/* Directory List */}
            <div className="h-72 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center h-full text-red-500 dark:text-red-400 p-4">
                  <p className="text-sm text-center">{error}</p>
                  <button
                    onClick={handleGoToDrives}
                    className="mt-4 px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 underline"
                  >
                    ドライブ一覧に戻る
                  </button>
                </div>
              ) : directories.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-500 dark:text-zinc-400">
                  <FolderOpen className="w-12 h-12 mb-2 text-zinc-300 dark:text-zinc-600" />
                  <p className="text-sm">サブフォルダがありません</p>
                </div>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {directories.map((dir) => {
                    // ドライブかどうかを判定（C:\, D:\ などのパターン）
                    const isDrive = /^[A-Z]:\\?$/.test(dir.path);
                    return (
                      <button
                        key={dir.path}
                        onClick={() => handleNavigate(dir.path)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors text-left"
                      >
                        {isDrive ? (
                          <HardDrive className="w-5 h-5 text-blue-500 shrink-0" />
                        ) : (
                          <Folder className="w-5 h-5 text-amber-500 shrink-0" />
                        )}
                        <span className="flex-1 text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate">
                          {dir.name}
                        </span>
                        <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                選択中:{" "}
                <span className="font-mono text-zinc-700 dark:text-zinc-300">
                  {currentPath || "なし"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSelect}
                  disabled={!currentPath}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check className="w-4 h-4" />
                  選択
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DirectoryPicker;
