'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Link as LinkIcon, ChevronRight, ChevronDown, Globe, Eye } from 'lucide-react';
import { useFavoriteLinks } from '@/hooks/use-favorite-links';
import { openExternalLinkInSplitView } from '@/utils/external-links';
import { groupLinksByDomain } from '@/utils/link-grouping';
import { getFaviconUrl } from '@/utils/favicon';
import type { FavoriteLink } from '@/types/favorite-link';
import Link from 'next/link';

export function FavoriteLinksWidget() {
  const { favoriteLinks, visitFavoriteLink } = useFavoriteLinks();
  const [isOpen, setIsOpen] = useState(false);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ドメイン別にグループ化
  const domainGroups = useMemo(() => {
    return groupLinksByDomain(favoriteLinks);
  }, [favoriteLinks]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleLinkClick = async (link: FavoriteLink) => {
    // 訪問カウントを更新
    await visitFavoriteLink(link);
    // その後、外部リンクを開く
    openExternalLinkInSplitView(link.url);
    setIsOpen(false);
  };

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(domain)) {
        newSet.delete(domain);
      } else {
        newSet.add(domain);
      }
      return newSet;
    });
  };

  if (favoriteLinks.length === 0) {
    return null;
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 hover:bg-gray-100 dark:hover:bg-indigo-dark-800 rounded-lg transition-colors flex items-center gap-1"
        title="お気に入りリンク"
      >
        <LinkIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-indigo-dark-900 rounded-lg shadow-xl border border-gray-200 dark:border-indigo-dark-700/70 overflow-hidden z-50">
          <div className="p-2 border-b border-gray-200 dark:border-indigo-dark-700">
            <h3 className="font-medium text-sm text-gray-900 dark:text-white">お気に入りリンク</h3>
          </div>

          {/* リンクリスト */}
          <div className="max-h-80 overflow-y-auto">
            {domainGroups.length === 0 ? (
              <div className="p-3 text-center text-gray-500 dark:text-gray-400 text-sm">
                お気に入りリンクがありません
              </div>
            ) : (
              domainGroups.map((group) => (
                <div key={group.domain} className="border-b border-gray-100 dark:border-indigo-dark-700/50 last:border-0">
                  {/* ドメインヘッダー */}
                  <button
                    onClick={() => toggleDomain(group.domain)}
                    className="w-full px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-indigo-dark-800/50 transition-all duration-200 flex items-center gap-2"
                  >
                    {expandedDomains.has(group.domain) ? (
                      <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                    )}

                    {/* Domain favicon */}
                    {group.links[0] && (
                      <img
                        src={getFaviconUrl(group.links[0].url)}
                        alt=""
                        className="w-3.5 h-3.5 rounded-sm"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          e.currentTarget.nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                    )}
                    <Globe className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 hidden" />

                    <span className="flex-1 text-left text-xs font-medium text-gray-700 dark:text-gray-300">
                      {group.displayName}
                    </span>

                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {group.links.length}
                    </span>

                    {group.totalVisitCount > 0 && (
                      <div className="flex items-center gap-0.5">
                        <Eye className="w-3 h-3 text-gray-400 dark:text-gray-500" />
                        <span className="text-xs text-gray-400 dark:text-gray-500">{group.totalVisitCount}</span>
                      </div>
                    )}
                  </button>

                  {/* リンク一覧 */}
                  {expandedDomains.has(group.domain) && (
                    <div className="pl-6">
                      {group.links.map((link) => (
                        <button
                          key={link.id}
                          onClick={() => handleLinkClick(link)}
                          className="w-full px-2 py-1 hover:bg-gray-50 dark:hover:bg-indigo-dark-800/50 transition-all duration-200 flex items-center gap-2 text-left"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors line-clamp-1">
                              {link.title}
                            </div>
                            {link.description && (
                              <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                                {link.description}
                              </div>
                            )}
                          </div>
                          {link.visitCount > 0 && (
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              {link.visitCount}
                            </span>
                          )}
                          <ChevronRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* フッター */}
          <div className="p-1.5 border-t border-gray-200 dark:border-indigo-dark-700">
            <Link
              href="/favorite-links"
              onClick={() => setIsOpen(false)}
              className="block w-full px-2 py-1.5 text-center text-xs text-blue-600 dark:text-blue-400 hover:bg-gray-50 dark:hover:bg-indigo-dark-800/50 rounded transition-all duration-200"
            >
              すべて見る
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}