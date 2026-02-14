'use client';

import { useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useFavoriteLinks } from '@/hooks/use-favorite-links';
import { FavoriteLinkModal } from './FavoriteLinkModal';
import { DomainGroupAccordion } from './DomainGroupAccordion';
import { groupLinksByDomain } from '@/utils/link-grouping';
import type { FavoriteLink } from '@/types/favorite-link';

export function FavoriteLinksManager() {
  const { favoriteLinks, isLoading, createFavoriteLink, updateFavoriteLink, deleteFavoriteLink, visitFavoriteLink } = useFavoriteLinks();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<FavoriteLink | undefined>();
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [linkToDelete, setLinkToDelete] = useState<FavoriteLink | null>(null);


  // Group links by domain
  const domainGroups = useMemo(() => {
    return groupLinksByDomain(favoriteLinks);
  }, [favoriteLinks]);

  const handleCreate = () => {
    setEditingLink(undefined);
    setIsModalOpen(true);
  };

  const handleEdit = (link: FavoriteLink) => {
    setEditingLink(link);
    setIsModalOpen(true);
  };

  const handleDelete = (link: FavoriteLink) => {
    setLinkToDelete(link);
    setIsDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (linkToDelete) {
      await deleteFavoriteLink(linkToDelete.id);
      setIsDeleteConfirmOpen(false);
      setLinkToDelete(null);
    }
  };

  const handleSave = async (data: any) => {
    if (editingLink) {
      await updateFavoriteLink(editingLink.id, data);
    } else {
      await createFavoriteLink(data);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 dark:text-gray-400">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">お気に入りリンク</h2>
        <button
          onClick={handleCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white text-sm rounded-lg transition-all duration-200 hover:shadow-lg hover:scale-105 active:scale-95"
        >
          <Plus className="w-4 h-4" />
          追加
        </button>
      </div>

      {/* Links List */}
      {favoriteLinks.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            お気に入りリンクがまだありません
          </p>
          <button
            onClick={handleCreate}
            className="mt-2 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-500"
          >
            最初のリンクを追加
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {domainGroups.map((group, index) => (
            <DomainGroupAccordion
              key={group.domain}
              group={group}
              onVisit={visitFavoriteLink}
              onEdit={handleEdit}
              onDelete={handleDelete}
              defaultOpen={index === 0} // 最初のグループは開いておく
            />
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <FavoriteLinkModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSave}
        link={editingLink}
        mode={editingLink ? 'edit' : 'create'}
      />

      {/* Delete Confirmation Dialog */}
      {isDeleteConfirmOpen && linkToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-indigo-dark-900 rounded-xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              リンクを削除しますか？
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              「{linkToDelete.title || (() => {
                try {
                  const url = new URL(linkToDelete.url);
                  return url.hostname.replace('www.', '');
                } catch {
                  return linkToDelete.url;
                }
              })()}」を削除してもよろしいですか？この操作は取り消せません。
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-indigo-dark-800 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
              >
                キャンセル
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-white rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 hover:shadow-lg"
              >
                削除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}