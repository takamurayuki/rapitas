/**
 * 通知設定管理用カスタムフック
 * localStorageに設定を永続化し、トグル操作を提供する
 */

import { useState, useCallback, useEffect } from 'react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useNotificationPreferences');

const STORAGE_KEY = 'rapitas:notification-preferences';

export interface NotificationPreferences {
  enabled: boolean;
  sound: boolean;
  desktop: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  sound: true,
  desktop: false,
};

function loadPreferences(): NotificationPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored
      ? { ...DEFAULT_PREFERENCES, ...JSON.parse(stored) }
      : DEFAULT_PREFERENCES;
  } catch (error) {
    logger.error('Failed to load notification preferences:', error);
    return DEFAULT_PREFERENCES;
  }
}

export function useNotificationPreferences() {
  const [preferences, setPreferences] =
    useState<NotificationPreferences>(loadPreferences);

  // クライアントサイドでマウント時にlocalStorageから再読み込み
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setPreferences(loadPreferences());
  }, []);

  const savePreferences = useCallback((prefs: NotificationPreferences) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (error) {
      logger.error('Failed to save notification preferences:', error);
    }
  }, []);

  const updatePreference = useCallback(
    <K extends keyof NotificationPreferences>(
      key: K,
      value: NotificationPreferences[K],
    ) => {
      setPreferences((prev) => {
        const next = { ...prev, [key]: value };
        savePreferences(next);
        return next;
      });
    },
    [savePreferences],
  );

  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES);
    savePreferences(DEFAULT_PREFERENCES);
  }, [savePreferences]);

  return { preferences, updatePreference, resetPreferences };
}
