'use client';

import React from 'react';
import { Bell, Check, Circle } from 'lucide-react';

interface NotificationItem {
  id: number;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
}

interface NotificationListProps {
  notifications: NotificationItem[];
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}

export default function NotificationList({
  notifications,
  onMarkRead,
  onMarkAllRead,
}: NotificationListProps) {
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="flex flex-col bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
          <Bell className="w-4 h-4" />
          通知
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-red-500 text-white">
              {unreadCount}
            </span>
          )}
        </h3>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            すべて既読にする
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
          通知はありません
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-700 max-h-80 overflow-y-auto">
          {notifications.map((item) => (
            <li
              key={item.id}
              className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                item.isRead ? 'bg-white dark:bg-zinc-800' : 'bg-indigo-50/50 dark:bg-indigo-900/10'
              }`}
            >
              <span className="mt-1 flex-shrink-0">
                {item.isRead ? (
                  <Check className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600" />
                ) : (
                  <Circle className="w-3.5 h-3.5 text-indigo-500 fill-indigo-500" />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {item.title}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                  {item.message}
                </p>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                  {formatRelativeTime(item.createdAt)}
                </span>
              </div>
              {!item.isRead && (
                <button
                  type="button"
                  onClick={() => onMarkRead(item.id)}
                  className="text-xs text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex-shrink-0"
                >
                  既読
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
