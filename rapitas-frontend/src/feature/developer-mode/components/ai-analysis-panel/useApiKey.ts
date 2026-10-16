'use client';
// ai-analysis-panel/useApiKey.ts

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { useConfirmDialog } from '@/components/ui/dialog/ConfirmDialogProvider';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useApiKey');

export type UseApiKeyReturn = {
  apiKeyInput: string;
  setApiKeyInput: (v: string) => void;
  showApiKey: boolean;
  setShowApiKey: (v: boolean) => void;
  maskedApiKey: string | null;
  isApiKeyConfigured: boolean;
  isEditingApiKey: boolean;
  setIsEditingApiKey: (v: boolean) => void;
  isSavingApiKey: boolean;
  apiKeyError: string | null;
  apiKeySuccess: string | null;
  saveApiKey: () => Promise<void>;
  deleteApiKey: () => Promise<void>;
};

/**
 * Manages Claude API key configuration state and CRUD operations.
 *
 * @returns State values and handler functions for API key management.
 */
export function useApiKey(): UseApiKeyReturn {
  const t = useTranslations('devMode.apiKey');
  const tCommon = useTranslations('common');
  const confirm = useConfirmDialog();
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [maskedApiKey, setMaskedApiKey] = useState<string | null>(null);
  const [isApiKeyConfigured, setIsApiKeyConfigured] = useState(false);
  const [isEditingApiKey, setIsEditingApiKey] = useState(false);
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeySuccess, setApiKeySuccess] = useState<string | null>(null);

  const fetchApiKey = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-key`);
      if (res.ok) {
        const data = await res.json();
        if (data.configured && data.maskedKey) {
          setMaskedApiKey(data.maskedKey);
          setIsApiKeyConfigured(true);
        } else {
          setMaskedApiKey(null);
          setIsApiKeyConfigured(false);
        }
      }
    } catch (err) {
      logger.error('APIキー情報の取得に失敗:', err);
    }
  };

  // Fetch existing key configuration on mount.
  useEffect(() => {
    fetchApiKey();
  }, []);

  const saveApiKey = async () => {
    if (!apiKeyInput.trim()) return;

    setIsSavingApiKey(true);
    setApiKeyError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput }),
      });

      if (res.ok) {
        const data = await res.json();
        setMaskedApiKey(data.maskedKey);
        setApiKeyInput('');
        setIsEditingApiKey(false);
        setShowApiKey(false);
        setIsApiKeyConfigured(true);
        setApiKeySuccess(t('savedMessage'));
        // NOTE: Clear success message after 3 s to avoid stale UI feedback.
        setTimeout(() => setApiKeySuccess(null), 3000);
      } else {
        throw new Error(tCommon('saveFailed'));
      }
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : t('genericError'));
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const deleteApiKey = async () => {
    if (!(await confirm({ message: t('deleteConfirm'), variant: 'destructive' }))) return;

    setIsSavingApiKey(true);
    setApiKeyError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-key`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setMaskedApiKey(null);
        setApiKeyInput('');
        setIsEditingApiKey(false);
        setIsApiKeyConfigured(false);
        setApiKeySuccess(t('deletedMessage'));
        setTimeout(() => setApiKeySuccess(null), 3000);
      } else {
        throw new Error(tCommon('deleteFailed'));
      }
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : t('genericError'));
    } finally {
      setIsSavingApiKey(false);
    }
  };

  return {
    apiKeyInput,
    setApiKeyInput,
    showApiKey,
    setShowApiKey,
    maskedApiKey,
    isApiKeyConfigured,
    isEditingApiKey,
    setIsEditingApiKey,
    isSavingApiKey,
    apiKeyError,
    apiKeySuccess,
    saveApiKey,
    deleteApiKey,
  };
}
