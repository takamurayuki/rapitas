'use client';
// usePromptOptimization

import { useState, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type { OptimizedPromptResult } from './prompt-optimization-types';

/**
 * Manages all state and async operations for prompt optimization.
 *
 * @param taskId - Task ID used for the optimization API call / 最適化APIに使用するタスクID
 * @param onPromptGenerated - Optional callback invoked with the final prompt / 最終プロンプトを受け取るコールバック
 * @returns State values and handlers for the PromptOptimizationPanel
 */
export function usePromptOptimization(
  taskId: number,
  onPromptGenerated?: (prompt: string) => void,
) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<OptimizedPromptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSubmittingAnswers, setIsSubmittingAnswers] = useState(false);

  const generatePrompt = useCallback(
    async (clarificationAnswers?: Record<string, string>) => {
      setIsGenerating(true);
      setError(null);

      try {
        const response = await fetch(
          `${API_BASE_URL}/developer-mode/optimize-prompt/${taskId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clarificationAnswers }),
          },
        );

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || 'プロンプト生成に失敗しました');
        }

        const data: OptimizedPromptResult = await response.json();
        setResult(data);

        // NOTE: Callback is skipped when questions are present; called after answers are submitted.
        if (!data.hasQuestions && onPromptGenerated) {
          onPromptGenerated(data.optimizedPrompt);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Errorが発生しました');
      } finally {
        setIsGenerating(false);
      }
    },
    [taskId, onPromptGenerated],
  );

  const handleSubmitAnswers = useCallback(async () => {
    if (!result?.clarificationQuestions) return;

    const requiredQuestions = result.clarificationQuestions.filter(
      (q) => q.isRequired,
    );
    const unansweredRequired = requiredQuestions.filter(
      (q) => !answers[q.id]?.trim(),
    );
    if (unansweredRequired.length > 0) {
      setError('必須の質問に回答してください');
      return;
    }

    setIsSubmittingAnswers(true);
    setError(null);

    // Convert question-ID-keyed answers to question-text-keyed answers
    const clarificationAnswers: Record<string, string> = {};
    result.clarificationQuestions.forEach((q) => {
      if (answers[q.id]) {
        clarificationAnswers[q.question] = answers[q.id];
      }
    });

    try {
      await generatePrompt(clarificationAnswers);
      setAnswers({});
    } finally {
      setIsSubmittingAnswers(false);
    }
  }, [result, answers, generatePrompt]);

  const handleCopyPrompt = useCallback(() => {
    if (result?.optimizedPrompt) {
      navigator.clipboard.writeText(result.optimizedPrompt);
      setCopied(true);
      // NOTE: Auto-reset copied state after 2s matches common clipboard UX patterns.
      setTimeout(() => setCopied(false), 2000);
    }
  }, [result]);

  const handleUsePrompt = useCallback(() => {
    if (result?.optimizedPrompt && onPromptGenerated) {
      onPromptGenerated(result.optimizedPrompt);
    }
  }, [result, onPromptGenerated]);

  const handleRetry = useCallback(() => {
    setError(null);
    generatePrompt();
  }, [generatePrompt]);

  const handleReset = useCallback(() => {
    setResult(null);
    generatePrompt();
  }, [generatePrompt]);

  return {
    isGenerating,
    result,
    error,
    showDetails,
    setShowDetails,
    copied,
    answers,
    setAnswers,
    isSubmittingAnswers,
    generatePrompt,
    handleSubmitAnswers,
    handleCopyPrompt,
    handleUsePrompt,
    handleRetry,
    handleReset,
    setResult,
  };
}
