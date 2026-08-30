'use client';

import { useState, useRef, useEffect } from 'react';
import { Bell, Check, CheckCheck, X } from 'lucide-react';
import Link from 'next/link';
import { checkIsTaskDetailPage } from '@/components/header/types';
import { useTranslations } from 'next-intl';
import { useNotifications } from '@/feature/developer-mode/hooks/useNotifications';
import type { Notification } from '@/types';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { resolveNotificationIcon, resolveNotificationText } from './notification-type-icons';

/**
 * Keep the header visible when a notification opens a task.
 *
 * The task-detail page hides the global header unless `showHeader=true` is
 * present — that is deliberate, and every other in-app route into it says so
 * (ExecutionItem, QuickActions, DayEventsSidebar). Notification links were
 * stored as bare `/tasks/<id>`, so following one dropped the header and left
 * no way back.
 *
 * Applied at navigation time rather than when the notification is written, so
 * the notifications already in the database are fixed too.
 *
 * @param link - The notification's stored link. / 通知に保存されたリンク
 * @returns The link, with showHeader=true when it opens a task detail page. / 必要なら付与したリンク
 */
export function withHeaderVisible(link: string): string {
  const [path, query] = link.split('?');
  if (!checkIsTaskDetailPage(path)) return link;
  const params = new URLSearchParams(query ?? '');
  if (params.has('showHeader')) return link;
  params.set('showHeader', 'true');
  return `${path}?${params.toString()}`;
}

export default function NotificationBell() {
  const t = useTranslations('notification');
  const tc = useTranslations('common');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const {
    notifications,
    unreadCount,
    isLoading,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    deleteAllNotifications,
  } = useNotifications();

  // Close dropdown when clicking outside
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

  // Fetch notifications when dropdown is opened
  useEffect(() => {
    if (isOpen) {
      fetchNotifications(false, 10);
    }
  }, [isOpen, fetchNotifications]);

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.isRead) {
      await markAsRead(notification.id);
    }
    setIsOpen(false);
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return t('justNow');
    if (diffMins < 60) return t('minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('hoursAgo', { count: diffHours });
    if (diffDays < 7) return t('daysAgo', { count: diffDays });
    return date.toLocaleDateString(dateLocale, {
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
        aria-label={t('title')}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <Bell className="w-5 h-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label={t('title')}
          className="absolute right-0 mt-2 w-80 bg-white dark:bg-indigo-dark-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden z-50"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">{t('title')}</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
                  aria-label={t('markAllRead')}
                >
                  <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('markAllRead')}
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={deleteAllNotifications}
                  className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 hover:underline"
                  aria-label={t('deleteAll')}
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('deleteAll')}
                </button>
              )}
            </div>
          </div>

          {/* Notifications List */}
          <div className="max-h-80 overflow-y-auto" aria-live="polite">
            {isLoading ? (
              <div className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                {tc('loading')}
              </div>
            ) : notifications.length === 0 ? (
              <EmptyState icon={Bell} title={t('noNotifications')} />
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`relative group ${
                    !notification.isRead ? 'bg-violet-50/50 dark:bg-violet-900/10' : ''
                  }`}
                >
                  {notification.link ? (
                    <Link
                      href={withHeaderVisible(notification.link)}
                      role="menuitem"
                      onClick={() => handleNotificationClick(notification)}
                      className="block px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                    >
                      <NotificationContent notification={notification} formatTime={formatTime} />
                    </Link>
                  ) : (
                    <div className="px-4 py-3" role="menuitem">
                      <NotificationContent notification={notification} formatTime={formatTime} />
                    </div>
                  )}

                  {/* Actions */}
                  <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!notification.isRead && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          markAsRead(notification.id);
                        }}
                        className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded transition-colors"
                        aria-label={t('markAsRead')}
                      >
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteNotification(notification.id);
                      }}
                      className="p-1 text-zinc-400 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded transition-colors"
                      aria-label={tc('delete')}
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  {/* Unread indicator */}
                  {!notification.isRead && (
                    <div
                      className="absolute left-[42px] top-2.5 w-2 h-2 bg-violet-500 rounded-full"
                      aria-hidden="true"
                    />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationContent({
  notification,
  formatTime,
}: {
  notification: Notification;
  formatTime: (date: string) => string;
}) {
  const t = useTranslations('notification');
  const { title, message } = resolveNotificationText(t, notification);
  const { Icon, colorClass } = resolveNotificationIcon(notification.type);
  return (
    <div className="flex items-start gap-3">
      <div
        className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${colorClass}`}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50 truncate">{title}</p>
        <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">{message}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
          {formatTime(notification.createdAt)}
        </p>
      </div>
    </div>
  );
}
