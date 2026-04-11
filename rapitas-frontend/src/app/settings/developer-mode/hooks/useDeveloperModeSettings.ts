/**
 * useDeveloperModeSettings
 *
 * Custom hook that manages fetching, updating, and local state for developer-mode settings.
 * Encapsulates API calls and debounced delay input so page.tsx stays lean.
 */

'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import type { UserSettings } from '@/types';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useDeveloperModeSettings');

export interface UseDeveloperModeSettingsReturn {
  settings: UserSettings | null;
  isLoading: boolean;
  isSaving: boolean;
  isSavingAutoResume: boolean;
  error: string | null;
  localDelay: number | '';
  updateSettings: (updates: Partial<UserSettings>) => Promise<void>;
  toggleAutoResume: () => Promise<void>;
  handleDelayChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDelayBlur: () => void;
}

/**
 * Provides all settings state and handlers needed by DeveloperModeSettingsPage.
 *
 * @returns Settings state and action handlers / 設定状態とアクションハンドラー
 */
export function useDeveloperModeSettings(): UseDeveloperModeSettingsReturn {
  const t = useTranslations('settings');
  const { showToast } = useToast();

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAutoResume, setIsSavingAutoResume] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // NOTE: Local state for instant UI feedback; actual save is debounced.
  const [localDelay, setLocalDelay] = useState<number | ''>(3);
  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setLocalDelay(data.autoGenerateTitleDelay ?? 3);
      }
    } catch {
      setError(t('fetchFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    return () => {
      if (delayTimerRef.current) {
        clearTimeout(delayTimerRef.current);
      }
    };
  }, []);

  const updateSettings = useCallback(
    async (updates: Partial<UserSettings>) => {
      setIsSaving(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        if (res.ok) {
          const data = await res.json();
          setSettings((prev) => (prev ? { ...prev, ...data } : data));
        } else {
          const errorData = await res.json().catch(() => null);
          const errorMsg =
            errorData?.message || errorData?.error || t('devUpdateFailed');
          throw new Error(errorMsg);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('devErrorOccurred');
        setError(msg);
        showToast(
          err instanceof Error ? err.message : t('devSaveFailed'),
          'error',
        );
      } finally {
        setIsSaving(false);
      }
    },
    [t, showToast],
  );

  const saveDelayDebounced = useCallback(
    (val: number) => {
      if (delayTimerRef.current) {
        clearTimeout(delayTimerRef.current);
      }
      delayTimerRef.current = setTimeout(() => {
        updateSettings({ autoGenerateTitleDelay: val });
      }, 500);
    },
    [updateSettings],
  );

  const handleDelayChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (raw === '') {
        setLocalDelay('');
        return;
      }
      const num = Number(raw);
      if (isNaN(num)) return;
      const clamped = Math.max(1, Math.min(30, num));
      setLocalDelay(clamped);
      saveDelayDebounced(clamped);
    },
    [saveDelayDebounced],
  );

  const handleDelayBlur = useCallback(() => {
    // Reset to default if left empty on blur
    if (localDelay === '' || localDelay < 1) {
      setLocalDelay(3);
      saveDelayDebounced(3);
    }
  }, [localDelay, saveDelayDebounced]);

  const toggleAutoResume = useCallback(async () => {
    if (!settings) return;
    const newValue = !settings.autoResumeInterruptedTasks;
    setIsSavingAutoResume(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoResumeInterruptedTasks: newValue }),
      });
      if (res.ok) {
        setSettings((prev) =>
          prev ? { ...prev, autoResumeInterruptedTasks: newValue } : prev,
        );
      } else {
        const errorData = await res.json().catch(() => null);
        const errorMsg =
          errorData?.message || errorData?.error || t('devSaveFailed');
        setError(errorMsg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('devSaveFailed'));
    } finally {
      setIsSavingAutoResume(false);
    }
  }, [settings, t]);

  logger.debug('Developer mode settings hook initialized');

  return {
    settings,
    isLoading,
    isSaving,
    isSavingAutoResume,
    error,
    localDelay,
    updateSettings,
    toggleAutoResume,
    handleDelayChange,
    handleDelayBlur,
  };
}
