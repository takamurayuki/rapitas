'use client';
// ai-analysis-panel/usePromptsManagement.ts

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { useConfirmDialog } from '@/components/ui/dialog/ConfirmDialogProvider';
import type { PromptsData } from './types';

export type UsePromptsManagementReturn = {
  promptsData: PromptsData | null;
  isLoadingPrompts: boolean;
  isGeneratingAll: boolean;
  editingPromptId: number | null;
  editingPromptText: string;
  setEditingPromptText: (v: string) => void;
  promptsError: string | null;
  fetchPrompts: () => Promise<void>;
  generateAllPrompts: () => Promise<void>;
  updatePrompt: (promptId: number, newText: string) => Promise<void>;
  deletePrompt: (promptId: number) => Promise<void>;
  startEditing: (promptId: number, currentText: string) => void;
  cancelEditing: () => void;
};

/**
 * Manages the saved-prompts list for a given task, including CRUD and batch generation.
 *
 * @param taskId - The task whose prompts to manage.
 * @returns State values and handler functions for prompt list management.
 */
export function usePromptsManagement(taskId: number): UsePromptsManagementReturn {
  const t = useTranslations('devMode.promptsManagement');
  const tCommon = useTranslations('common');
  const confirm = useConfirmDialog();
  const [promptsData, setPromptsData] = useState<PromptsData | null>(null);
  const [isLoadingPrompts, setIsLoadingPrompts] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [editingPromptId, setEditingPromptId] = useState<number | null>(null);
  const [editingPromptText, setEditingPromptText] = useState('');
  const [promptsError, setPromptsError] = useState<string | null>(null);

  // NOTE: memoized — consumers (e.g. AIAnalysisPanel's tab-switch effect) depend
  // on this function's identity; an unmemoized version recreated every render
  // would re-trigger that effect on every render and fetch in a loop.
  const fetchPrompts = useCallback(async () => {
    setIsLoadingPrompts(true);
    setPromptsError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/prompts`);
      if (res.ok) {
        const data = await res.json();
        setPromptsData(data);
      } else {
        throw new Error(t('fetchFailed'));
      }
    } catch (err) {
      setPromptsError(err instanceof Error ? err.message : t('genericError'));
    } finally {
      setIsLoadingPrompts(false);
    }
  }, [taskId, t]);

  const generateAllPrompts = async () => {
    if (
      !(await confirm({
        message: t('generateAllConfirm'),
      }))
    )
      return;

    setIsGeneratingAll(true);
    setPromptsError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/prompts/generate-all`, {
        method: 'POST',
      });
      if (res.ok) {
        await fetchPrompts();
      } else {
        const errData = await res.json();
        throw new Error(errData.error || t('generateAllFailed'));
      }
    } catch (err) {
      setPromptsError(err instanceof Error ? err.message : t('genericError'));
    } finally {
      setIsGeneratingAll(false);
    }
  };

  const updatePrompt = async (promptId: number, newText: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/prompts/${promptId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optimizedPrompt: newText }),
      });
      if (res.ok) {
        setEditingPromptId(null);
        setEditingPromptText('');
        await fetchPrompts();
      } else {
        throw new Error(tCommon('updateFailed'));
      }
    } catch (err) {
      setPromptsError(err instanceof Error ? err.message : t('genericError'));
    }
  };

  const deletePrompt = async (promptId: number) => {
    if (!(await confirm({ message: t('deleteConfirm'), variant: 'destructive' }))) return;

    try {
      const res = await fetch(`${API_BASE_URL}/prompts/${promptId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchPrompts();
      } else {
        throw new Error(tCommon('deleteFailed'));
      }
    } catch (err) {
      setPromptsError(err instanceof Error ? err.message : t('genericError'));
    }
  };

  const startEditing = (promptId: number, currentText: string) => {
    setEditingPromptId(promptId);
    setEditingPromptText(currentText);
  };

  const cancelEditing = () => {
    setEditingPromptId(null);
    setEditingPromptText('');
  };

  return {
    promptsData,
    isLoadingPrompts,
    isGeneratingAll,
    editingPromptId,
    editingPromptText,
    setEditingPromptText,
    promptsError,
    fetchPrompts,
    generateAllPrompts,
    updatePrompt,
    deletePrompt,
    startEditing,
    cancelEditing,
  };
}
