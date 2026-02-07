"use client";

import { useState, useEffect, useRef } from "react";
import {
  Folder,
  FolderOpen,
  FolderPlus,
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
  Star,
  StarOff,
  Trash2,
  ChevronDown,
} from "lucide-react";
import { API_BASE_URL } from "@/utils/api";

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

type FavoriteDirectory = {
  id: number;
  path: string;
  name: string | null;
  isGitRepo: boolean;
  createdAt: string;
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
  const [favorites, setFavorites] = useState<FavoriteDirectory[]>([]);
  const [showFavorites, setShowFavorites] = useState(true);
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(false);
  const [favoritesOnlyMode, setFavoritesOnlyMode] = useState(false); // お気に入りのみ表示モード
  const [showFavoritesDropdown, setShowFavoritesDropdown] = useState(false);
  const [isEditing, setIsEditing] = useState(false); // インライン編集モード
  const [editValue, setEditValue] = useState(""); // 編集中の値
  const [isCreatingFolder, setIsCreatingFolder] = useState(false); // 新規フォルダ作成モード
  const [newFolderName, setNewFolderName] = useState(""); // 新規フォルダ名
  const [isCreating, setIsCreating] = useState(false); // 作成中フラグ
  const [createError, setCreateError] = useState<string | null>(null); // 作成エラー
  const dropdownRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  // 初回マウント時にお気に入りを取得
  useEffect(() => {
    fetchFavorites();
  }, []);

  // ドロップダウン外クリックで閉じる & インライン編集外クリックで反映
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowFavoritesDropdown(false);
      }
      // インライン編集中に外側をクリックしたら反映
      if (
        editInputRef.current &&
        !editInputRef.current.contains(event.target as Node) &&
        isEditing
      ) {
        handleEditComplete();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isEditing, editValue]);

  // インライン編集開始
  const handleStartEdit = () => {
    setEditValue(value);
    setIsEditing(true);
    // 次のレンダリング後にフォーカス
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  };

  // インライン編集完了
  const handleEditComplete = () => {
    if (editValue !== value) {
      onChange(editValue);
    }
    setIsEditing(false);
  };

  // インライン編集キャンセル
  const handleEditCancel = () => {
    setIsEditing(false);
    setEditValue(value);
  };

  // お気に入り一覧を取得
  const fetchFavorites = async () => {
    setIsLoadingFavorites(true);
    try {
      const res = await fetch(`${API_BASE_URL}/directories/favorites`);
      const data = await res.json();
      if (!data.error) {
        setFavorites(data);
      }
    } catch (err) {
      console.error("Failed to fetch favorites:", err);
    } finally {
      setIsLoadingFavorites(false);
    }
  };

  // お気に入りに追加
  const addToFavorites = async (dirPath: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/directories/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dirPath }),
      });
      const data = await res.json();
      if (!data.error) {
        setFavorites((prev) => [data, ...prev]);
      }
    } catch (err) {
      console.error("Failed to add favorite:", err);
    }
  };

  // お気に入りから削除
  const removeFromFavorites = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/directories/favorites/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        setFavorites((prev) => prev.filter((f) => f.id !== id));
      }
    } catch (err) {
      console.error("Failed to remove favorite:", err);
    }
  };

  // 現在のパスがお気に入りに登録されているか確認
  const isFavorite = (dirPath: string) => {
    return favorites.some((f) => f.path === dirPath);
  };

  // 現在のパスのお気に入りIDを取得
  const getFavoriteId = (dirPath: string) => {
    const fav = favorites.find((f) => f.path === dirPath);
    return fav?.id;
  };

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
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ディレクトリの取得に失敗しました",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpen = async () => {
    setIsOpen(true);
    setManualPath("");
    setShowFavorites(true);

    // まずお気に入りを取得
    setIsLoadingFavorites(true);
    try {
      const res = await fetch(`${API_BASE_URL}/directories/favorites`);
      const data = await res.json();
      if (!data.error && Array.isArray(data) && data.length > 0) {
        setFavorites(data);
        // お気に入りがある場合は、お気に入りのみ表示モードで開始
        setFavoritesOnlyMode(true);
        // ディレクトリブラウズは開始しない（お気に入りから選択を促す）
        setCurrentPath("");
        setDirectories([]);
        setParentPath(null);
        setIsGitRepo(false);
        setIsDriveList(false);
      } else {
        setFavorites(data.error ? [] : data);
        setFavoritesOnlyMode(false);
        // お気に入りがない場合は通常のブラウズを開始
        if (value) {
          browseDirectory(value);
        } else {
          browseDirectory();
        }
      }
    } catch (err) {
      console.error("Failed to fetch favorites:", err);
      setFavorites([]);
      setFavoritesOnlyMode(false);
      // エラー時も通常のブラウズを開始
      if (value) {
        browseDirectory(value);
      } else {
        browseDirectory();
      }
    } finally {
      setIsLoadingFavorites(false);
    }
  };

  // お気に入りモードからフォルダブラウズに切り替え
  const handleStartBrowsing = () => {
    setFavoritesOnlyMode(false);
    if (value) {
      browseDirectory(value);
    } else {
      browseDirectory();
    }
  };

  // 新規フォルダ作成を開始
  const handleStartCreateFolder = () => {
    setIsCreatingFolder(true);
    setNewFolderName("");
    setCreateError(null);
    setTimeout(() => {
      newFolderInputRef.current?.focus();
    }, 0);
  };

  // 新規フォルダ作成をキャンセル
  const handleCancelCreateFolder = () => {
    setIsCreatingFolder(false);
    setNewFolderName("");
    setCreateError(null);
  };

  // 新規フォルダを作成
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      setCreateError("フォルダ名を入力してください");
      return;
    }

    // フォルダ名のバリデーション
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(newFolderName)) {
      setCreateError("フォルダ名に使用できない文字が含まれています");
      return;
    }

    const separator = currentPath.includes("\\") ? "\\" : "/";
    const newPath = currentPath
      ? `${currentPath}${currentPath.endsWith("\\") || currentPath.endsWith("/") ? "" : separator}${newFolderName.trim()}`
      : newFolderName.trim();

    setIsCreating(true);
    setCreateError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/directories/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: newPath }),
      });

      const data = await res.json();

      if (!data.success) {
        setCreateError(data.error || "フォルダの作成に失敗しました");
        return;
      }

      // 作成成功 → フォルダ一覧を更新して新しいフォルダに移動
      setIsCreatingFolder(false);
      setNewFolderName("");
      setCreateError(null);

      // 新しく作成されたフォルダに移動
      browseDirectory(data.path);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "フォルダの作成に失敗しました"
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setError(null);
    setManualPath("");
    setIsCreatingFolder(false);
    setNewFolderName("");
    setCreateError(null);
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

  // テーマの作業ディレクトリが設定されているかチェック
  const hasThemeDirectory = !!value;

  return (
    <div className={`relative ${className}`}>
      {/* Path Display - シンプルで直感的なデザイン */}
      <div className="flex gap-2">
        {/* パス入力/表示エリア */}
        <div className="flex-1 relative">
          {isEditing ? (
            /* 編集モード */
            <div className="flex items-center">
              <input
                ref={editInputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleEditComplete();
                  } else if (e.key === "Escape") {
                    handleEditCancel();
                  }
                }}
                className="flex-1 rounded-lg border-2 border-purple-500 dark:border-purple-400 bg-white dark:bg-zinc-800 px-4 py-2.5 pr-24 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/30 transition-all font-mono"
                placeholder="パスを入力..."
              />
              <div className="absolute right-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleEditComplete}
                  className="p-1.5 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 rounded transition-colors"
                  title="確定"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleEditCancel}
                  className="p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded transition-colors"
                  title="キャンセル"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            /* 表示モード */
            <div className="flex items-center rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 overflow-hidden">
              <div className="flex-1 flex items-center px-4 py-2.5 min-w-0">
                {value ? (
                  <>
                    <Folder className="w-4 h-4 text-amber-500 shrink-0 mr-2" />
                    <span className="text-sm font-mono text-zinc-700 dark:text-zinc-300 truncate">
                      {value}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-zinc-400 dark:text-zinc-500">
                    {placeholder}
                  </span>
                )}
              </div>
              {/* 編集ボタン - 常に表示 */}
              <button
                type="button"
                onClick={handleStartEdit}
                className="px-3 py-2.5 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 border-l border-zinc-300 dark:border-zinc-700 transition-colors"
                title="パスを直接入力"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* 参照ボタン */}
        <button
          type="button"
          onClick={handleOpen}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-all text-sm font-medium shrink-0"
          title="フォルダを参照"
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

            {/* Navigation Bar - お気に入りモード時は非表示 */}
            {!favoritesOnlyMode && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-zinc-700">
                {/* ナビゲーションボタン */}
                <div className="flex items-center gap-1 border-r border-zinc-200 dark:border-zinc-700 pr-2 mr-1">
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
                </div>

                {/* 現在のパス表示 */}
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg overflow-x-auto min-w-0">
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

                {/* お気に入り & フォルダ作成ボタン */}
                <div className="flex items-center gap-1 border-l border-zinc-200 dark:border-zinc-700 pl-2 ml-1">
                  {/* 新規フォルダ作成ボタン */}
                  {currentPath && !isDriveList && (
                    <button
                      onClick={handleStartCreateFolder}
                      disabled={isCreatingFolder}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors disabled:opacity-50"
                      title="新規フォルダを作成"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">新規</span>
                    </button>
                  )}

                  {/* お気に入り表示切り替え */}
                  <button
                    onClick={() => setShowFavorites(!showFavorites)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      showFavorites
                        ? "text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 dark:text-yellow-400"
                        : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                    title={showFavorites ? "お気に入りを非表示" : "お気に入りを表示"}
                  >
                    <Star className={`w-3.5 h-3.5 ${showFavorites ? "fill-current" : ""}`} />
                    <span className="hidden sm:inline">{favorites.length}</span>
                  </button>

                  {/* 現在のパスをお気に入りに追加/削除 */}
                  {currentPath && (
                    <button
                      onClick={() => {
                        if (isFavorite(currentPath)) {
                          const favId = getFavoriteId(currentPath);
                          if (favId) removeFromFavorites(favId);
                        } else {
                          addToFavorites(currentPath);
                        }
                      }}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        isFavorite(currentPath)
                          ? "text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400"
                          : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      }`}
                      title={isFavorite(currentPath) ? "お気に入りから削除" : "お気に入りに追加"}
                    >
                      {isFavorite(currentPath) ? (
                        <>
                          <Star className="w-3.5 h-3.5 fill-current" />
                          <span className="hidden sm:inline">登録済</span>
                        </>
                      ) : (
                        <>
                          <StarOff className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">追加</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Manual Path Input - お気に入りモード時は非表示 */}
            {!favoritesOnlyMode && (
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
            )}

            {/* Favorites Only Mode - お気に入りがある場合の初期表示 */}
            {favoritesOnlyMode && favorites.length > 0 ? (
              <div className="h-72 flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-900/10 dark:to-amber-900/10 border-b border-yellow-100 dark:border-yellow-900/30">
                  <div className="flex items-center gap-2">
                    <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                    <div>
                      <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                        お気に入りから選択
                      </span>
                      <span className="text-xs text-yellow-600/70 dark:text-yellow-500/70 ml-2">
                        ({favorites.length}件)
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={handleStartBrowsing}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 bg-white dark:bg-zinc-800 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-md transition-colors border border-purple-200 dark:border-purple-800"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    別のフォルダを選択
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
                  {favorites.map((fav) => {
                    const isCurrentValue = value && fav.path === value;
                    return (
                      <div
                        key={fav.id}
                        className={`flex items-center gap-2 px-4 py-3 transition-colors group ${
                          isCurrentValue
                            ? "bg-purple-50 dark:bg-purple-900/20 border-l-4 border-purple-500"
                            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                        }`}
                      >
                        <button
                          onClick={() => {
                            onChange(fav.path);
                            handleClose();
                          }}
                          className="flex-1 flex items-center gap-3 text-left min-w-0"
                        >
                          <Folder
                            className={`w-5 h-5 shrink-0 ${isCurrentValue ? "text-purple-500" : "text-yellow-500"}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div
                              className={`text-sm font-medium truncate ${isCurrentValue ? "text-purple-700 dark:text-purple-300" : "text-zinc-700 dark:text-zinc-300"}`}
                            >
                              {fav.name || fav.path.split(/[\\/]/).pop()}
                              {isCurrentValue && (
                                <span className="ml-2 text-xs font-normal text-purple-500 dark:text-purple-400">
                                  (現在選択中)
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-zinc-400 dark:text-zinc-500 truncate font-mono">
                              {fav.path}
                            </div>
                          </div>
                          {fav.isGitRepo && (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded text-xs shrink-0">
                              <GitBranch className="w-3 h-3" />
                            </span>
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromFavorites(fav.id);
                          }}
                          className="p-1.5 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all rounded-md hover:bg-red-50 dark:hover:bg-red-900/20"
                          title="お気に入りから削除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <>
                {/* New Folder Creation Form */}
                {isCreatingFolder && (
                  <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-green-50 dark:bg-green-900/10">
                    <div className="flex items-center gap-2 mb-2">
                      <FolderPlus className="w-4 h-4 text-green-600 dark:text-green-400" />
                      <span className="text-sm font-medium text-green-700 dark:text-green-300">
                        新規フォルダを作成
                      </span>
                      <span className="text-xs text-zinc-400 dark:text-zinc-500 font-mono ml-1">
                        in {currentPath}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        ref={newFolderInputRef}
                        type="text"
                        value={newFolderName}
                        onChange={(e) => {
                          setNewFolderName(e.target.value);
                          setCreateError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleCreateFolder();
                          } else if (e.key === "Escape") {
                            handleCancelCreateFolder();
                          }
                        }}
                        placeholder="フォルダ名を入力..."
                        className="flex-1 px-3 py-1.5 text-sm bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                        disabled={isCreating}
                      />
                      <button
                        onClick={handleCreateFolder}
                        disabled={!newFolderName.trim() || isCreating}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isCreating ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        作成
                      </button>
                      <button
                        onClick={handleCancelCreateFolder}
                        disabled={isCreating}
                        className="p-1.5 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-md transition-colors disabled:opacity-50"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    {createError && (
                      <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                        {createError}
                      </p>
                    )}
                  </div>
                )}

                {/* Favorites Section - 通常モード時のお気に入り表示 */}
                {showFavorites && favorites.length > 0 && (
                  <div className="border-b border-zinc-200 dark:border-zinc-700">
                    <div className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-900/10 dark:to-amber-900/10">
                      <div className="flex items-center gap-2">
                        <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                        <span className="text-xs font-medium text-yellow-700 dark:text-yellow-400">
                          お気に入り ({favorites.length})
                        </span>
                      </div>
                      <button
                        onClick={() => setShowFavorites(false)}
                        className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                      >
                        非表示
                      </button>
                    </div>
                    <div className="max-h-32 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
                      {favorites.map((fav) => {
                        const isCurrentValue = value && fav.path === value;
                        return (
                          <div
                            key={fav.id}
                            className={`flex items-center gap-2 px-4 py-2 transition-colors group ${
                              isCurrentValue
                                ? "bg-purple-50 dark:bg-purple-900/20 border-l-4 border-purple-500"
                                : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                            }`}
                          >
                            <button
                              onClick={() => handleNavigate(fav.path)}
                              className="flex-1 flex items-center gap-3 text-left min-w-0"
                            >
                              <Folder
                                className={`w-4 h-4 shrink-0 ${isCurrentValue ? "text-purple-500" : "text-yellow-500"}`}
                              />
                              <div className="flex-1 min-w-0">
                                <div
                                  className={`text-sm font-medium truncate ${isCurrentValue ? "text-purple-700 dark:text-purple-300" : "text-zinc-700 dark:text-zinc-300"}`}
                                >
                                  {fav.name || fav.path.split(/[\\/]/).pop()}
                                  {isCurrentValue && (
                                    <span className="ml-2 text-xs font-normal text-purple-500 dark:text-purple-400">
                                      (現在選択中)
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-zinc-400 dark:text-zinc-500 truncate font-mono">
                                  {fav.path}
                                </div>
                              </div>
                              {fav.isGitRepo && (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded text-xs shrink-0">
                                  <GitBranch className="w-3 h-3" />
                                </span>
                              )}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFromFavorites(fav.id);
                              }}
                              className="p-1.5 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all rounded-md hover:bg-red-50 dark:hover:bg-red-900/20"
                              title="お気に入りから削除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Directory List - 通常モード時のディレクトリ一覧 */}
                <div
                  className={`overflow-y-auto ${showFavorites && favorites.length > 0 ? "h-40" : "h-72"}`}
                >
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
              </>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
              {favoritesOnlyMode ? (
                <>
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">
                    お気に入りからフォルダを選択してください
                  </div>
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                  >
                    キャンセル
                  </button>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DirectoryPicker;
