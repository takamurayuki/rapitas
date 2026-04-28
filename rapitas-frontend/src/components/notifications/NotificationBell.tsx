'use client';

import { useState, useRef, useEffect } from 'react';
import { Bell, BookOpen, Check, CheckCheck, ExternalLink, Lightbulb, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useNotifications } from '@/feature/developer-mode/hooks/useNotifications';
import type { Notification } from '@/types';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';

const typeIcons: Record<string, string> = {
  approval_request: 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400',
  task_completed: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  agent_error: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  daily_summary: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  pr_review_requested: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  pr_approved: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  pr_changes_requested: 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400',
  agent_execution_started: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400',
  agent_execution_complete:
    'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
  github_sync_complete: 'bg-gray-100 dark:bg-gray-900/30 text-gray-600 dark:text-gray-400',
  knowledge_extracted: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
  knowledge_reminder: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
};

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
              <div className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                {t('noNotifications')}
              </div>
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
                      href={notification.link}
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

          {/* Footer */}
          <Link
            href="/approvals"
            onClick={() => setIsOpen(false)}
            className="flex items-center justify-center gap-2 px-4 py-3 text-sm text-violet-600 dark:text-violet-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border-t border-zinc-200 dark:border-zinc-800 transition-colors"
          >
            <span>{t('viewPendingApprovals')}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
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
  return (
    <div className="flex items-start gap-3">
      <div
        className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${typeIcons[notification.type]}`}
      >
        {notification.type === 'approval_request' && (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        )}
        {notification.type === 'task_completed' && <Check className="w-4 h-4" />}
        {notification.type === 'agent_error' && (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        )}
        {notification.type === 'daily_summary' && (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        )}
        {notification.type === 'pr_review_requested' && (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
        )}
        {notification.type === 'knowledge_extracted' && <Lightbulb className="w-4 h-4" />}
        {notification.type === 'knowledge_reminder' && <BookOpen className="w-4 h-4" />}
        {notification.type === 'agent_execution_started' && (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50 truncate">
          {notification.title}
        </p>
        <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
          {notification.message}
        </p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
          {formatTime(notification.createdAt)}
        </p>
      </div>
    </div>
  );
}
