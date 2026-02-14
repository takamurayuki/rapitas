'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Globe, Eye, Edit2, Trash2, MoreVertical } from 'lucide-react';
import { Menu } from '@headlessui/react';
import type { DomainGroup } from '@/utils/link-grouping';
import type { FavoriteLink } from '@/types/favorite-link';
import { openExternalLinkInSplitView } from '@/utils/external-links';
import { getFaviconUrl } from '@/utils/favicon';

interface DomainGroupAccordionProps {
  group: DomainGroup;
  onVisit: (link: FavoriteLink) => void;
  onEdit: (link: FavoriteLink) => void;
  onDelete: (link: FavoriteLink) => void;
  defaultOpen?: boolean;
}

export function DomainGroupAccordion({
  group,
  onVisit,
  onEdit,
  onDelete,
  defaultOpen = false,
}: DomainGroupAccordionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [faviconErrors, setFaviconErrors] = useState<Record<string, boolean>>({});

  const handleLinkClick = async (e: React.MouseEvent, link: FavoriteLink) => {
    e.preventDefault();
    e.stopPropagation();
    // 訪問カウントを更新
    await onVisit(link);
    // その後、外部リンクを開く
    openExternalLinkInSplitView(link.url);
  };

  const handleFaviconError = (linkId: number) => {
    setFaviconErrors((prev) => ({ ...prev, [linkId]: true }));
  };

  // グループのfaviconを最初のリンクから取得
  const groupFaviconUrl = group.links[0] ? getFaviconUrl(group.links[0].url) : null;

  return (
    <div className="border border-gray-200 dark:border-indigo-dark-700 rounded-lg overflow-hidden shadow-sm">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2.5 bg-gray-50 dark:bg-indigo-dark-800/50 hover:bg-gray-100 dark:hover:bg-indigo-dark-700/50 transition-all duration-200 flex items-center gap-2"
      >
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        )}

        {/* Domain favicon */}
        {groupFaviconUrl && !faviconErrors[group.links[0].id] ? (
          <img
            src={groupFaviconUrl}
            alt=""
            className="w-4 h-4 rounded-sm"
            onError={() => handleFaviconError(group.links[0].id)}
          />
        ) : (
          <Globe className="w-4 h-4 text-gray-400 dark:text-gray-500" />
        )}

        <span className="flex-1 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
          {group.displayName}
        </span>

        <span className="text-xs text-gray-500 dark:text-gray-400">
          {group.links.length} リンク
        </span>

        {group.totalVisitCount > 0 && (
          <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
            <Eye className="w-3 h-3" />
            <span>{group.totalVisitCount}</span>
          </div>
        )}
      </button>

      {isOpen && (
        <div className="divide-y divide-gray-100 dark:divide-indigo-dark-700">
          {group.links.map((link) => (
            <div
              key={link.id}
              className="group relative hover:bg-gray-50 dark:hover:bg-indigo-dark-800/30 transition-all duration-200"
            >
              <a
                href={link.url}
                onClick={(e) => handleLinkClick(e, link)}
                className="block px-3 py-2"
                target="_blank"
                rel="noopener noreferrer"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1">
                      {link.title}
                    </h3>
                    {link.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 mt-0.5">
                        {link.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate flex-1">
                        {link.url}
                      </p>
                      {link.visitCount > 0 && (
                        <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                          <Eye className="w-3 h-3" />
                          <span>{link.visitCount}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </a>

              {/* Actions menu */}
              <Menu
                as="div"
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Menu.Button className="p-1 rounded hover:bg-gray-200 dark:hover:bg-indigo-dark-700">
                  <MoreVertical className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                </Menu.Button>
                <Menu.Items className="absolute right-0 mt-1 w-32 bg-white dark:bg-indigo-dark-800 rounded-md shadow-lg border border-gray-200 dark:border-indigo-dark-700 py-1 z-10">
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={() => onEdit(link)}
                        className={`${
                          active ? 'bg-gray-100 dark:bg-indigo-dark-700' : ''
                        } flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 w-full text-left`}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        編集
                      </button>
                    )}
                  </Menu.Item>
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={() => onDelete(link)}
                        className={`${
                          active ? 'bg-gray-100 dark:bg-indigo-dark-700' : ''
                        } flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 w-full text-left`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        削除
                      </button>
                    )}
                  </Menu.Item>
                </Menu.Items>
              </Menu>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}