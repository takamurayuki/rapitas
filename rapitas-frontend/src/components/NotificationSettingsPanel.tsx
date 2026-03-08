'use client';

import React, { useState, useCallback } from 'react';
import { Bell, BellOff, Moon } from 'lucide-react';

interface NotificationSettings {
  enabled: boolean;
  sound: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  sound: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
};

export default function NotificationSettingsPanel() {
  const [settings, setSettings] = useState<NotificationSettings>(() => {
    try {
      const saved = localStorage.getItem('rapitas-notification-settings');
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const update = useCallback(<K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem('rapitas-notification-settings', JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col gap-4 p-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
        <Bell className="w-4 h-4" />
        通知設定
      </h3>

      <label className="flex items-center justify-between text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
        <span className="flex items-center gap-2">
          {settings.enabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
          通知を有効にする
        </span>
        <input type="checkbox" checked={settings.enabled} onChange={(e) => update('enabled', e.target.checked)}
          className="rounded border-zinc-300 dark:border-zinc-600 text-indigo-600 focus:ring-indigo-500" />
      </label>

      <label className="flex items-center justify-between text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
        通知音
        <input type="checkbox" checked={settings.sound} onChange={(e) => update('sound', e.target.checked)}
          className="rounded border-zinc-300 dark:border-zinc-600 text-indigo-600 focus:ring-indigo-500" />
      </label>

      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-3">
        <label className="flex items-center justify-between text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer mb-2">
          <span className="flex items-center gap-2"><Moon className="w-4 h-4" />おやすみモード</span>
          <input type="checkbox" checked={settings.quietHoursEnabled} onChange={(e) => update('quietHoursEnabled', e.target.checked)}
            className="rounded border-zinc-300 dark:border-zinc-600 text-indigo-600 focus:ring-indigo-500" />
        </label>
        {settings.quietHoursEnabled && (
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <input type="time" value={settings.quietHoursStart} onChange={(e) => update('quietHoursStart', e.target.value)}
              className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300" />
            <span>~</span>
            <input type="time" value={settings.quietHoursEnd} onChange={(e) => update('quietHoursEnd', e.target.value)}
              className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300" />
          </div>
        )}
      </div>
    </div>
  );
}
