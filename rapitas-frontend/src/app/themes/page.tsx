'use client';
import { useEffect, useState, useMemo } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  Save,
  X,
  Search,
  Star,
  SwatchBook,
  Code,
  FolderGit2,
  GitBranch,
  FolderOpen,
  FolderPlus,
  AlertCircle,
  CheckCircle,
  Loader2,
  GripVertical,
} from 'lucide-react';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { ListSkeleton } from '@/components/ui/LoadingSpinner';
import { DirectoryPicker } from '@/components/ui/DirectoryPicker';
import {
  ICON_DATA,
  searchIcons,
  getIconComponent,
} from '@/components/category/IconData';
import type { Theme, Category } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { useDebounce } from '@/hooks/useDebounce';
import { IconGrid } from '@/components/category/IconGrid';

// 作業ディレクトリをお気に入りに自動登録する関数
const addWorkingDirectoryToFavorites = async (path: string) => {
  if (!path.trim()) return;

  try {
    // まず既にお気に入りに登録されているか確認
    const checkRes = await fetch(`${API_BASE_URL}/directories/favorites`);
    const favorites = await checkRes.json();

    if (!Array.isArray(favorites)) return;

    const isAlreadyFavorite = favorites.some(
      (f: { path: string }) => f.path === path,
    );
    if (isAlreadyFavorite) return;

    // お気に入りに追加
    await fetch(`${API_BASE_URL}/directories/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
  } catch (err) {
    console.error('Failed to add working directory to favorites:', err);
  }
};

type FormData = {
  name: string;
  description: string;
  color: string;
  icon: string;
  isDevelopment: boolean;
  repositoryUrl: string;
  workingDirectory: string;
  defaultBranch: string;
  categoryId: number | null;
};

const defaultFormData: FormData = {
  name: '',
  description: '',
  color: '#8B5CF6',
  icon: '',
  isDevelopment: false,
  repositoryUrl: '',
  workingDirectory: '',
  defaultBranch: 'main',
  categoryId: null,
};

export default function ThemesPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [iconSearchQuery, setIconSearchQuery] = useState('');
  const [formData, setFormData] = useState<FormData>(defaultFormData);
  const [dirStatus, setDirStatus] = useState<{
    checking: boolean;
    exists: boolean | null;
    isGitRepo: boolean;
  }>({ checking: false, exists: null, isGitRepo: false });
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingDir, setIsCreatingDir] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(
    null,
  );
  const [initialCategorySet, setInitialCategorySet] = useState(false);

  // 作業ディレクトリの存在チェック
  const checkDirectory = async (dirPath: string) => {
    if (!dirPath.trim()) {
      setDirStatus({ checking: false, exists: null, isGitRepo: false });
      return;
    }

    setDirStatus({ checking: true, exists: null, isGitRepo: false });

    try {
      const res = await fetch(`${API_BASE_URL}/directories/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath }),
      });
      const data = await res.json();

      setDirStatus({
        checking: false,
        exists: data.valid,
        isGitRepo: data.isGitRepo || false,
      });

      // フォルダが存在しない場合、新規作成UIを表示
      if (!data.valid) {
        setShowCreateFolder(true);
        // パスの最後のセグメントをフォルダ名のデフォルトとして設定
        const segments = dirPath.replace(/[\\/]+$/, '').split(/[\\/]/);
        setNewFolderName(segments[segments.length - 1] || '');
      } else {
        setShowCreateFolder(false);
        setNewFolderName('');
      }
    } catch {
      setDirStatus({ checking: false, exists: null, isGitRepo: false });
    }
  };

  // 新規フォルダ作成
  const handleCreateDirectory = async () => {
    const dirPath = formData.workingDirectory.trim();
    if (!dirPath) return;

    setIsCreatingDir(true);

    try {
      const res = await fetch(`${API_BASE_URL}/directories/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath }),
      });
      const data = await res.json();

      if (data.success) {
        showToast('フォルダを作成しました', 'success');
        setDirStatus({ checking: false, exists: true, isGitRepo: false });
        setShowCreateFolder(false);
        setNewFolderName('');
      } else {
        showToast(data.error || 'フォルダの作成に失敗しました', 'error');
      }
    } catch {
      showToast('フォルダの作成に失敗しました', 'error');
    } finally {
      setIsCreatingDir(false);
    }
  };

  // 親ディレクトリ + 新フォルダ名でパスを構成して作成
  const handleCreateNewFolder = async () => {
    if (!newFolderName.trim()) {
      showToast('フォルダ名を入力してください', 'error');
      return;
    }

    // フォルダ名のバリデーション
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(newFolderName)) {
      showToast('フォルダ名に使用できない文字が含まれています', 'error');
      return;
    }

    // 現在の作業ディレクトリパスの親ディレクトリを取得
    const currentPath = formData.workingDirectory.trim();
    const parentPath = currentPath.replace(/[\\/][^\\/]*[\\/]?$/, '');
    const separator = currentPath.includes('\\') ? '\\' : '/';
    const newPath = parentPath + separator + newFolderName.trim();

    setIsCreatingDir(true);

    try {
      const res = await fetch(`${API_BASE_URL}/directories/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath }),
      });
      const data = await res.json();

      if (data.success) {
        showToast('フォルダを作成しました', 'success');
        // 作成したフォルダをworkingDirectoryに設定
        setFormData({ ...formData, workingDirectory: data.path });
        setDirStatus({ checking: false, exists: true, isGitRepo: false });
        setShowCreateFolder(false);
        setNewFolderName('');
      } else {
        showToast(data.error || 'フォルダの作成に失敗しました', 'error');
      }
    } catch {
      showToast('フォルダの作成に失敗しました', 'error');
    } finally {
      setIsCreatingDir(false);
    }
  };

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/themes`);
      if (!res.ok) throw new Error('取得に失敗しました');
      setItems(await res.json());
    } catch (e) {
      console.error(e);
      showToast('テーマの取得に失敗しました', 'error');
    } finally {
      setLoading(false);
    }
  };

  const seedDefaults = async () => {
    try {
      await fetch(`${API_BASE_URL}/categories/seed-defaults`, {
        method: 'POST',
      });
    } catch (e) {
      console.error('Failed to seed default categories:', e);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/categories`);
      if (res.ok) {
        const data = await res.json();
        setCategories(data);
        // 初回ロード時: 最初のカテゴリを選択し、フォームにもカテゴリの初期値を設定
        if (data.length > 0) {
          if (!initialCategorySet) {
            setSelectedCategoryId(data[0].id);
            setInitialCategorySet(true);
          }
          if (!formData.categoryId) {
            setFormData((prev) => ({
              ...prev,
              categoryId: prev.categoryId ?? data[0].id,
            }));
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    seedDefaults().then(() => {
      fetchItems();
      fetchCategories();
    });
  }, []);

  const handleAdd = async () => {
    if (!formData.name.trim()) {
      showToast('テーマ名を入力してください', 'error');
      return;
    }
    if (!formData.categoryId) {
      showToast('カテゴリを選択してください', 'error');
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/themes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error('作成に失敗しました');

      // 開発プロジェクトの場合、作業ディレクトリをお気に入りに自動登録
      if (formData.isDevelopment && formData.workingDirectory) {
        await addWorkingDirectoryToFavorites(formData.workingDirectory);
      }

      showToast('テーマを作成しました', 'success');
      setIsAdding(false);
      resetForm();
      fetchItems();
    } catch (e) {
      console.error(e);
      showToast('テーマの作成に失敗しました', 'error');
    }
  };

  const handleUpdate = async (id: number) => {
    if (!formData.name.trim()) {
      showToast('テーマ名を入力してください', 'error');
      return;
    }
    if (!formData.categoryId) {
      showToast('カテゴリを選択してください', 'error');
      return;
    }

    try {
      console.log('Updating theme with data:', formData);
      const res = await fetch(`${API_BASE_URL}/themes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const responseText = await res.text();
      console.log('Response status:', res.status, 'Response:', responseText);

      if (!res.ok) {
        let errorMessage = `更新に失敗しました (${res.status})`;
        try {
          const errorData = JSON.parse(responseText);
          if (errorData.error) {
            errorMessage = errorData.error;
          }
        } catch {
          // JSONパースに失敗した場合はテキストをそのまま使用
          if (responseText) {
            errorMessage = responseText;
          }
        }
        throw new Error(errorMessage);
      }

      // 開発プロジェクトの場合、作業ディレクトリをお気に入りに自動登録
      if (formData.isDevelopment && formData.workingDirectory) {
        await addWorkingDirectoryToFavorites(formData.workingDirectory);
      }

      showToast('テーマを更新しました', 'success');
      setEditingId(null);
      setIconSearchQuery('');
      fetchItems();
    } catch (e) {
      console.error('Theme update error:', e);
      showToast(
        e instanceof Error ? e.message : 'テーマの更新に失敗しました',
        'error',
      );
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`「${name}」を削除しますか？`)) return;

    try {
      const res = await fetch(`${API_BASE_URL}/themes/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('削除に失敗しました');

      showToast('テーマを削除しました', 'success');
      fetchItems();
    } catch (e) {
      console.error(e);
      showToast('テーマの削除に失敗しました', 'error');
    }
  };

  const setDefault = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/themes/${id}/set-default`, {
        method: 'PATCH',
      });

      if (!res.ok) throw new Error('デフォルト設定に失敗しました');

      showToast('デフォルトテーマを設定しました', 'success');
      fetchItems();
    } catch (e) {
      console.error(e);
      showToast('デフォルトテーマの設定に失敗しました', 'error');
    }
  };

  const startEdit = (item: Theme) => {
    setEditingId(item.id);
    setFormData({
      name: item.name,
      description: item.description || '',
      color: item.color,
      icon: item.icon || '',
      isDevelopment: item.isDevelopment || false,
      repositoryUrl: item.repositoryUrl || '',
      workingDirectory: item.workingDirectory || '',
      defaultBranch: item.defaultBranch || 'main',
      categoryId: item.categoryId ?? null,
    });
    setIconSearchQuery('');
    // 開発プロジェクトの場合、作業ディレクトリをチェック
    if (item.isDevelopment && item.workingDirectory) {
      checkDirectory(item.workingDirectory);
    } else {
      setDirStatus({ checking: false, exists: null, isGitRepo: false });
      setShowCreateFolder(false);
    }
  };

  const resetForm = () => {
    setFormData(defaultFormData);
    setIconSearchQuery('');
    setDirStatus({ checking: false, exists: null, isGitRepo: false });
    setShowCreateFolder(false);
    setNewFolderName('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsAdding(false);
    resetForm();
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination || result.source.index === result.destination.index)
      return;

    // droppableId からカテゴリIDを取得
    const droppableId = result.source.droppableId;
    const categoryId = droppableId.startsWith('themes-category-')
      ? parseInt(droppableId.replace('themes-category-', ''))
      : null;

    if (categoryId === null) return;

    // 該当カテゴリのテーマのみ取得（表示中のもの）
    const categoryItems = items
      .filter((item) => item.categoryId === categoryId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const reordered = Array.from(categoryItems);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);

    // items 全体の中で該当カテゴリのテーマのsortOrderを更新
    const reorderedMap = new Map(
      reordered.map((item, index) => [item.id, index]),
    );
    const newItems = items.map((item) => {
      if (reorderedMap.has(item.id)) {
        return { ...item, sortOrder: reorderedMap.get(item.id)! };
      }
      return item;
    });
    setItems(newItems);

    const orders = reordered.map((item, index) => ({
      id: item.id,
      sortOrder: index,
    }));

    try {
      const res = await fetch(`${API_BASE_URL}/themes/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders }),
      });
      if (!res.ok) throw new Error('並び替えに失敗しました');
    } catch (e) {
      console.error(e);
      showToast('並び替えに失敗しました', 'error');
      fetchItems();
    }
  };

  // デバウンスされた検索クエリ
  const debouncedIconSearchQuery = useDebounce(iconSearchQuery, 300);

  // メモ化されたアイコン検索結果（最大50個に制限）
  const filteredIcons = useMemo(() => {
    const results = searchIcons(debouncedIconSearchQuery);
    return results.slice(0, 50);
  }, [debouncedIconSearchQuery]);

  const renderIcon = (iconName: string | null | undefined, size = 20) => {
    const IconComponent = getIconComponent(iconName || '');
    if (IconComponent) {
      return <IconComponent size={size} />;
    }

    const DefaultIcon =
      getIconComponent('SwatchBook') ??
      ICON_DATA?.['SwatchBook']?.component ??
      SwatchBook;

    return <DefaultIcon size={size} />;
  };

  const renderForm = (isEdit: boolean, itemId?: number) => (
    <div className="space-y-4">
      {/* 基本情報 */}
      <div className="space-y-3">

        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            テーマ名 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="テーマ名を入力"
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            説明（任意）
          </label>
          <textarea
            value={formData.description}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
            placeholder="説明を入力"
            rows={1}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              カラー
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={formData.color}
                onChange={(e) =>
                  setFormData({ ...formData, color: e.target.value })
                }
                className="h-9 w-12 rounded-lg border border-zinc-300 dark:border-zinc-700 cursor-pointer"
              />
              <input
                type="text"
                value={formData.color}
                onChange={(e) =>
                  setFormData({ ...formData, color: e.target.value })
                }
                className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              選択中のアイコン
            </label>
            <div
              className="h-9 rounded-lg border-2 flex items-center justify-center"
              style={{
                borderColor: formData.color,
                backgroundColor: formData.color + '15',
              }}
            >
              <div style={{ color: formData.color }}>
                {renderIcon(formData.icon, 20)}
              </div>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            アイコンを選択 {!formData.icon && '(未選択時: SwatchBook)'}
          </label>

          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              type="text"
              value={iconSearchQuery}
              onChange={(e) => setIconSearchQuery(e.target.value)}
              placeholder="アイコンを検索...（例: 本、仕事、星）"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            />
          </div>

          <div className="max-h-36 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
            {filteredIcons.length === 50 && debouncedIconSearchQuery && (
              <div className="p-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
                表示数が多いため、最初の50件のみ表示しています。絞り込むには検索ワードを追加してください。
              </div>
            )}
            <div className="grid grid-cols-8 gap-1 p-2">
              <IconGrid
                icons={filteredIcons}
                selectedIcon={formData.icon}
                onIconSelect={(iconName) =>
                  setFormData({ ...formData, icon: iconName })
                }
                renderIcon={renderIcon}
                accentClass="bg-purple-500"
              />
            </div>
          </div>
        </div>
      </div>

      {/* カテゴリ選択 */}
      {categories.length > 0 && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4 space-y-3">
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            所属カテゴリ <span className="text-red-500">*</span>
          </label>
          {selectedCategoryId !== null ? (
            <div className="flex items-center gap-2">
              {(() => {
                const cat = categories.find(
                  (c) => c.id === formData.categoryId,
                );
                if (!cat) return null;
                return (
                  <span
                    className="inline-flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg"
                    style={{
                      backgroundColor: cat.color + '15',
                      color: cat.color,
                      border: `1px solid ${cat.color}40`,
                    }}
                  >
                    {renderIcon(cat.icon, 16)}
                    {cat.name}
                  </span>
                );
              })()}
            </div>
          ) : (
            <select
              value={formData.categoryId ?? ''}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  categoryId: e.target.value ? Number(e.target.value) : null,
                })
              }
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            >
              <option value="" disabled>
                カテゴリを選択してください
              </option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* 開発プロジェクト設定 */}
      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.isDevelopment}
            onChange={(e) => {
              const checked = e.target.checked;
              if (checked && !formData.categoryId) {
                const devCategory = categories.find(
                  (c) => c.name === '開発' && c.isDefault,
                );
                setFormData({
                  ...formData,
                  isDevelopment: true,
                  categoryId: devCategory?.id ?? formData.categoryId,
                });
              } else {
                setFormData({ ...formData, isDevelopment: checked });
              }
            }}
            className="w-4 h-4 rounded border-zinc-300 text-purple-600 focus:ring-purple-500"
          />
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
            <Code className="w-3.5 h-3.5" />
            開発プロジェクトとして設定
          </span>
        </label>

        {formData.isDevelopment && (
          <div className="space-y-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
            <p className="text-xs text-purple-700 dark:text-purple-300 mb-2">
              開発プロジェクトとして設定すると、このテーマのタスクでAI開発モードを使用する際に、以下の設定が自動適用されます。
            </p>

            <div>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1 flex items-center gap-1.5">
                <FolderGit2 className="w-3.5 h-3.5" />
                GitHubリポジトリURL
              </label>
              <input
                type="text"
                value={formData.repositoryUrl}
                onChange={(e) =>
                  setFormData({ ...formData, repositoryUrl: e.target.value })
                }
                placeholder="https://github.com/username/repository"
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1 flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5" />
                作業ディレクトリ（ローカルパス）
              </label>
              <DirectoryPicker
                value={formData.workingDirectory}
                onChange={(path) => {
                  setFormData({ ...formData, workingDirectory: path });
                  checkDirectory(path);
                }}
                placeholder="C:\Projects\my-project または /home/user/projects/my-project"
              />

              {/* ディレクトリ存在チェック結果 */}
              {formData.workingDirectory.trim() && (
                <div className="mt-2">
                  {dirStatus.checking ? (
                    <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      フォルダの存在を確認中...
                    </div>
                  ) : dirStatus.exists === true ? (
                    <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                      <CheckCircle className="w-3.5 h-3.5" />
                      フォルダが見つかりました
                      {dirStatus.isGitRepo && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 rounded text-xs">
                          <GitBranch className="w-3 h-3" />
                          Git
                        </span>
                      )}
                    </div>
                  ) : dirStatus.exists === false ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                        <AlertCircle className="w-3.5 h-3.5" />
                        フォルダが存在しません
                      </div>

                      {/* フォルダ作成UI */}
                      <div className="p-2 bg-amber-50 dark:bg-amber-900/10 rounded border border-amber-200 dark:border-amber-800">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleCreateDirectory}
                            disabled={isCreatingDir}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isCreatingDir ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <FolderPlus className="w-3 h-3" />
                            )}
                            作成
                          </button>
                          <span className="text-xs text-amber-700 dark:text-amber-300">
                            このパスにフォルダを作成
                          </span>
                        </div>

                        {/* 別のフォルダ名で作成 */}
                        {showCreateFolder && (
                          <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800">
                            <p className="text-xs text-amber-700 dark:text-amber-300 mb-1">
                              別のフォルダ名:
                            </p>
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={newFolderName}
                                onChange={(e) =>
                                  setNewFolderName(e.target.value)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleCreateNewFolder();
                                  }
                                }}
                                placeholder="フォルダ名..."
                                className="flex-1 px-2 py-1 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                                disabled={isCreatingDir}
                              />
                              <button
                                type="button"
                                onClick={handleCreateNewFolder}
                                disabled={
                                  !newFolderName.trim() || isCreatingDir
                                }
                                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isCreatingDir ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <FolderPlus className="w-3 h-3" />
                                )}
                                作成
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Claude
                Codeがコード変更を行うローカルのプロジェクトフォルダを指定してください。
              </p>
            </div>

            <div>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1 flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5" />
                デフォルトブランチ
              </label>
              <input
                type="text"
                value={formData.defaultBranch}
                onChange={(e) =>
                  setFormData({ ...formData, defaultBranch: e.target.value })
                }
                placeholder="main"
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button
          onClick={cancelEdit}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-all font-medium"
        >
          <X className="w-3.5 h-3.5" />
          キャンセル
        </button>
        <button
          onClick={() =>
            isEdit && itemId ? handleUpdate(itemId) : handleAdd()
          }
          className="flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 px-3 py-2 text-sm text-white transition-all shadow-lg hover:shadow-xl font-medium"
        >
          <Save className="w-3.5 h-3.5" />
          {isEdit ? '保存' : '作成'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* ヘッダー */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <SwatchBook className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              テーマ一覧
            </h1>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              テーマを管理します。開発プロジェクトの設定もここで行えます。
            </p>
          </div>
          {!isAdding && (
            <button
              onClick={() => {
                setFormData({
                  ...defaultFormData,
                  categoryId:
                    selectedCategoryId ??
                    (categories.length > 0 ? categories[0].id : null),
                });
                setIsAdding(true);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 text-sm text-white transition-all shadow-lg hover:shadow-xl font-medium"
            >
              <Plus className="w-4 h-4" />
              新規テーマ
            </button>
          )}
        </div>

        {/* カテゴリタブ */}
        {categories.length > 0 && (
          <div className="mb-4 flex items-center gap-1.5 overflow-x-auto pb-1">
            {categories.map((cat) => {
              const count = items.filter((t) => t.categoryId === cat.id).length;
              const isSelected = selectedCategoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => {
                    setSelectedCategoryId(cat.id);
                    cancelEdit();
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                    isSelected
                      ? 'text-white shadow-md'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  }`}
                  style={
                    isSelected ? { backgroundColor: cat.color } : undefined
                  }
                >
                  {renderIcon(cat.icon, 14)}
                  {cat.name}
                  <span
                    className={`text-xs px-1 py-0.5 rounded-full ${
                      isSelected
                        ? 'bg-white/20 text-white'
                        : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* 新規追加フォーム */}
        {isAdding && (
          <div className="mb-4 rounded-xl border-2 border-purple-500 bg-white dark:bg-indigo-dark-900 p-4 shadow-xl">
            {renderForm(false)}
          </div>
        )}

        {/* リスト（新規追加時は非表示） */}
        {!isAdding &&
          (loading ? (
            <ListSkeleton count={3} showTabs showBadges />
          ) : (
            (() => {
              const filteredItems =
                selectedCategoryId === null
                  ? items
                  : items.filter(
                      (item) => item.categoryId === selectedCategoryId,
                    );
              const sortedItems = [...filteredItems].sort(
                (a, b) => a.sortOrder - b.sortOrder,
              );
              const currentCategoryId =
                selectedCategoryId ??
                (categories.length > 0 ? categories[0].id : null);
              return sortedItems.length === 0 ? (
                <div className="text-center py-16 text-zinc-500 dark:text-zinc-400 bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <SwatchBook className="w-16 h-16 mx-auto mb-4 text-zinc-300 dark:text-zinc-700" />
                  <p className="text-lg font-medium mb-2">
                    このカテゴリにテーマがありません
                  </p>
                  <p className="text-sm mb-4">
                    新規テーマを作成して追加しましょう
                  </p>
                </div>
              ) : (
                <DragDropContext onDragEnd={handleDragEnd}>
                  <Droppable
                    droppableId={`themes-category-${currentCategoryId}`}
                  >
                    {(provided) => (
                      <div
                        className="grid gap-3"
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                      >
                        {sortedItems.map((item, index) => (
                          <Draggable
                            key={item.id}
                            draggableId={String(item.id)}
                            index={index}
                            isDragDisabled={editingId !== null || isAdding}
                          >
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className={`rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-indigo-dark-900 hover:shadow-lg transition-all overflow-hidden ${
                                  snapshot.isDragging
                                    ? 'shadow-2xl ring-2 ring-purple-500/50'
                                    : ''
                                }`}
                              >
                                {editingId === item.id ? (
                                  <div className="p-4">
                                    <h2 className="mb-3 text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                                      <Edit2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                                      テーマを編集
                                    </h2>
                                    {renderForm(true, item.id)}
                                  </div>
                                ) : (
                                  <div className="p-4 flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-4 flex-1 min-w-0">
                                      <div
                                        {...provided.dragHandleProps}
                                        className="flex items-center justify-center w-6 shrink-0 cursor-grab active:cursor-grabbing text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                                        title="ドラッグして並び替え"
                                      >
                                        <GripVertical className="w-5 h-5" />
                                      </div>
                                      <div
                                        className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0 shadow-sm"
                                        style={{
                                          backgroundColor: item.color + '20',
                                          color: item.color,
                                        }}
                                      >
                                        {renderIcon(item.icon, 20)}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50 truncate">
                                            {item.name}
                                          </h3>
                                          {item.isDevelopment && (
                                            <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                                              <Code className="w-3 h-3" />
                                              <span className="hidden sm:inline">開発</span>
                                            </span>
                                          )}
                                        </div>
                                        {item.description && (
                                          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 line-clamp-1">
                                            {item.description}
                                          </p>
                                        )}
                                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                          <span
                                            className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded"
                                            style={{
                                              backgroundColor:
                                                item.color + '15',
                                              color: item.color,
                                            }}
                                          >
                                            <div
                                              className="w-2 h-2 rounded-full"
                                              style={{
                                                backgroundColor: item.color,
                                              }}
                                            />
                                            {item.color}
                                          </span>
                                          {item._count && (
                                            <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                              <span className="font-semibold">
                                                {item._count.tasks}
                                              </span>
                                              <span className="hidden sm:inline">タスク</span>
                                            </span>
                                          )}
                                          {item.isDevelopment &&
                                            item.workingDirectory && (
                                              <span className="hidden md:flex text-xs text-zinc-500 dark:text-zinc-400 items-center gap-1 font-mono">
                                                <FolderOpen className="w-3 h-3" />
                                                {item.workingDirectory.length >
                                                30
                                                  ? '...' +
                                                    item.workingDirectory.slice(
                                                      -27,
                                                    )
                                                  : item.workingDirectory}
                                              </span>
                                            )}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <button
                                        onClick={() => setDefault(item.id)}
                                        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-all font-medium ${
                                          item.isDefault
                                            ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border-2 border-purple-500'
                                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                                        }`}
                                        title={
                                          item.isDefault
                                            ? `${item.category?.name ?? 'カテゴリ'}内のデフォルト`
                                            : `${item.category?.name ?? 'カテゴリ'}内のデフォルトに設定`
                                        }
                                      >
                                        <Star
                                          className={`w-3.5 h-3.5 ${item.isDefault ? 'fill-current' : ''}`}
                                        />
                                        <span className="hidden sm:inline">
                                          {item.isDefault
                                            ? 'デフォルト'
                                            : 'デフォルト設定'}
                                        </span>
                                      </button>
                                      <button
                                        onClick={() => startEdit(item)}
                                        className="flex items-center gap-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30 px-2.5 py-1.5 text-sm text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-all font-medium"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                        <span className="hidden sm:inline">編集</span>
                                      </button>
                                      <button
                                        onClick={() =>
                                          handleDelete(item.id, item.name)
                                        }
                                        className="flex items-center gap-1.5 rounded-lg bg-red-100 dark:bg-red-900/30 px-2.5 py-1.5 text-sm text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 transition-all font-medium"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span className="hidden sm:inline">削除</span>
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              );
            })()
          ))}
      </div>
    </div>
  );
}
