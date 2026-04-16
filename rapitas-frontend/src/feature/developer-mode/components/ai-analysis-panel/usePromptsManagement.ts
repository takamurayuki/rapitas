'use client';
// ai-analysis-panel/usePromptsManagement.ts

import { useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
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
export function usePromptsManagement(
  taskId: number,
): UsePromptsManagementReturn {
  const [promptsData, setPromptsData] = useState<PromptsData | null>(null);
  const [isLoadingPrompts, setIsLoadingPrompts] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [editingPromptId, setEditingPromptId] = useState<number | null>(null);
  const [editingPromptText, setEditingPromptText] = useState('');
  const [promptsError, setPromptsError] = useState<string | null>(null);

  const fetchPrompts = async () => {
    setIsLoadingPrompts(true);
    setPromptsError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/prompts`);
      if (res.ok) {
        const data = await res.json();
        setPromptsData(data);
      } else {
        throw new Error('プロンプト一覧の取得に失敗しました');
      }
    } catch (err) {
      setPromptsError(
        err instanceof Error ? err.message : 'Errorが発生しました',
      );
    } finally {
      setIsLoadingPrompts(false);
    }
  };

  const generateAllPrompts = async () => {
    if (
      !confirm('すべてのサブタスク（またはタスク）のプロンプトを生成しますか？')
    )
      return;

    setIsGeneratingAll(true);
    setPromptsError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/prompts/generate-all`,
        { method: 'POST' },
      );
      if (res.ok) {
        await fetchPrompts();
      } else {
        const errData = await res.json();
        throw new Error(errData.error || '一括生成に失敗しました');
      }
    } catch (err) {
      setPromptsError(
        err instanceof Error ? err.message : 'Errorが発生しました',
      );
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
        throw new Error('更新に失敗しました');
      }
    } catch (err) {
      setPromptsError(
        err instanceof Error ? err.message : 'Errorが発生しました',
      );
    }
  };

  const deletePrompt = async (promptId: number) => {
    if (!confirm('このプロンプトを削除しますか？')) return;

    try {
      const res = await fetch(`${API_BASE_URL}/prompts/${promptId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchPrompts();
      } else {
        throw new Error('削除に失敗しました');
      }
    } catch (err) {
      setPromptsError(
        err instanceof Error ? err.message : 'Errorが発生しました',
      );
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
