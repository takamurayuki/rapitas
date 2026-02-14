"use client";

import {
  Link as LinkIcon,
  Edit2,
  Trash2,
  MoreVertical,
  Eye,
} from "lucide-react";
import { Menu } from "@headlessui/react";
import { useState } from "react";
import type { FavoriteLink } from "@/types/favorite-link";
import { openExternalLinkInSplitView } from "@/utils/external-links";
import { getFaviconUrl } from "@/utils/favicon";

interface FavoriteLinkCardProps {
  link: FavoriteLink;
  onEdit: (link: FavoriteLink) => void;
  onDelete: (link: FavoriteLink) => void;
  onVisit: (link: FavoriteLink) => void;
}

export function FavoriteLinkCard({
  link,
  onEdit,
  onDelete,
  onVisit,
}: FavoriteLinkCardProps) {
  const [faviconError, setFaviconError] = useState(false);
  const faviconUrl = getFaviconUrl(link.url);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    // 訪問カウントを更新
    await onVisit(link);
    // その後、外部リンクを開く
    openExternalLinkInSplitView(link.url);
  };

  const handleFaviconError = () => {
    setFaviconError(true);
  };

  return (
    <div className="group relative bg-white dark:bg-indigo-dark-900 border border-gray-200 dark:border-indigo-dark-700 rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-indigo-dark-800 transition-colors">
      {/* Menu */}
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
                  active ? "bg-gray-100 dark:bg-indigo-dark-700" : ""
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
                  active ? "bg-gray-100 dark:bg-indigo-dark-700" : ""
                } flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 w-full text-left`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                削除
              </button>
            )}
          </Menu.Item>
        </Menu.Items>
      </Menu>

      {/* Content */}
      <a
        href={link.url}
        onClick={handleClick}
        className="flex items-center gap-2"
        target="_blank"
        rel="noopener noreferrer"
      >
        {/* Favicon or fallback icon */}
        <div className="w-4 h-4 flex-shrink-0">
          {!faviconError && faviconUrl ? (
            <img
              src={faviconUrl}
              alt=""
              className="w-4 h-4 rounded-sm"
              onError={handleFaviconError}
            />
          ) : (
            <LinkIcon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 line-clamp-1">
            {link.title}
          </h3>
          {link.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
              {link.description}
            </p>
          )}
          <div className="flex items-center gap-3">
            <p className="text-xs text-gray-400 dark:text-gray-500 truncate flex-1">
              {link.url}
            </p>
            {/* Visit count */}
            {link.visitCount > 0 && (
              <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                <Eye className="w-3 h-3" />
                <span>{link.visitCount}</span>
              </div>
            )}
          </div>
        </div>
      </a>
    </div>
  );
}
