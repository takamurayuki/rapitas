/**
 * ai-analysis-panel/usePromptOptimization.ts
 *
 * Hook encapsulating single-task prompt generation and clarification state.
 * Not responsible for saved-prompts list management — see use-prompts-management.ts.
 */

'use client';

import { useState, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type { OptimizedPromptResult } from './types';

export type UsePromptOptimizationReturn = {
  isGeneratingPrompt: boolean;
  promptResult: OptimizedPromptResult | null;
  setPromptResult: (v: OptimizedPromptResult | null) => void;
  promptError: string | null;
  setPromptError: (v: string | null) => void;
  copied: boolean;
  promptAnswers: Record<string, string>;
  setPromptAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  isSubmittingAnswers: boolean;
  generatePrompt: (clarificationAnswers?: Record<string, string>) => Promise<void>;
  handleSubmitAnswers: () => Promise<void>;
  handleCopyPrompt: () => void;
  handleUsePrompt: () => void;
};

/**
 * Manages prompt optimization generation, clarification Q&A, and clipboard copy.
 *
 * @param taskId - The task for which to generate an optimized prompt.
 * @param onPromptGenerated - Callback invoked with the final prompt string once available.
 * @returns State values and handler functions for prompt optimization.
 */
export function usePromptOptimization(
  taskId: number,
  onPromptGenerated?: (prompt: string) => void,
): UsePromptOptimizationReturn {
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [promptResult, setPromptResult] = useState<OptimizedPromptResult | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [promptAnswers, setPromptAnswers] = useState<Record<string, string>>({});
  const [isSubmittingAnswers, setIsSubmittingAnswers] = useState(false);

  const generatePrompt = useCallback(
    async (clarificationAnswers?: Record<string, string>) => {
      setIsGeneratingPrompt(true);
      setPromptError(null);

      try {
        const response = await fetch(
          `${API_BASE_URL}/developer-mode/optimize-prompt/${taskId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              clarificationAnswers ? { clarificationAnswers } : {},
            ),
          },
        );

        if (!response.ok) {
          const errData = await response.json();
          const errorMsg = errData.details
            ? `${errData.error}: ${errData.details}`
            : errData.error || 'プロンプト生成に失敗しました';
          throw new Error(errorMsg);
        }

        const data: OptimizedPromptResult = await response.json();
        setPromptResult(data);

        if (!data.hasQuestions && onPromptGenerated) {
          onPromptGenerated(data.optimizedPrompt);
        }
      } catch (err) {
        setPromptError(
          err instanceof Error ? err.message : 'Errorが発生しました',
        );
      } finally {
        setIsGeneratingPrompt(false);
      }
    },
    [taskId, onPromptGenerated],
  );

  const handleSubmitAnswers = useCallback(async () => {
    if (!promptResult?.clarificationQuestions) return;

    const requiredQuestions = promptResult.clarificationQuestions.filter(
      (q) => q.isRequired,
    );
    const unansweredRequired = requiredQuestions.filter(
      (q) => !promptAnswers[q.id]?.trim(),
    );
    if (unansweredRequired.length > 0) {
      setPromptError('必須の質問に回答してください');
      return;
    }

    setIsSubmittingAnswers(true);
    setPromptError(null);

    const clarificationAnswers: Record<string, string> = {};
    promptResult.clarificationQuestions.forEach((q) => {
      if (promptAnswers[q.id]) {
        clarificationAnswers[q.question] = promptAnswers[q.id];
      }
    });

    try {
      await generatePrompt(clarificationAnswers);
      setPromptAnswers({});
    } finally {
      setIsSubmittingAnswers(false);
    }
  }, [promptResult, promptAnswers, generatePrompt]);

  const handleCopyPrompt = useCallback(() => {
    if (promptResult?.optimizedPrompt) {
      navigator.clipboard.writeText(promptResult.optimizedPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [promptResult]);

  const handleUsePrompt = useCallback(() => {
    if (promptResult?.optimizedPrompt && onPromptGenerated) {
      onPromptGenerated(promptResult.optimizedPrompt);
    }
  }, [promptResult, onPromptGenerated]);

  return {
    isGeneratingPrompt,
    promptResult,
    setPromptResult,
    promptError,
    setPromptError,
    copied,
    promptAnswers,
    setPromptAnswers,
    isSubmittingAnswers,
    generatePrompt,
    handleSubmitAnswers,
    handleCopyPrompt,
    handleUsePrompt,
  };
}
