'use client';
// usePromptOptimization

import { useState, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type { PromptResult } from './types';

type UsePromptOptimizationOptions = {
  taskId: number;
  onPromptGenerated?: (prompt: string) => void;
};

type UsePromptOptimizationResult = {
  isGeneratingPrompt: boolean;
  promptResult: PromptResult | null;
  promptError: string | null;
  copied: boolean;
  questionAnswers: Record<string, string>;
  isSubmittingAnswers: boolean;
  setQuestionAnswers: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  setPromptResult: React.Dispatch<React.SetStateAction<PromptResult | null>>;
  setPromptError: React.Dispatch<React.SetStateAction<string | null>>;
  generatePrompt: (
    clarificationAnswers?: Record<string, string>,
  ) => Promise<void>;
  handleSubmitAnswers: () => Promise<void>;
  handleCopyPrompt: () => void;
  handleUsePrompt: () => void;
  getCategoryLabel: (category: string) => string;
};

/**
 * Manages prompt optimization lifecycle: generation, clarification Q&A, copy, and use.
 *
 * @param options.taskId - Task whose description is being optimized.
 * @param options.onPromptGenerated - Called with the final prompt when no questions remain.
 * @returns State values and event handlers for the prompt panel UI.
 */
export function usePromptOptimization({
  taskId,
  onPromptGenerated,
}: UsePromptOptimizationOptions): UsePromptOptimizationResult {
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [promptResult, setPromptResult] = useState<PromptResult | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [questionAnswers, setQuestionAnswers] = useState<
    Record<string, string>
  >({});
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
            body: JSON.stringify({ clarificationAnswers }),
          },
        );

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || 'プロンプト生成に失敗しました');
        }

        const data: PromptResult = await response.json();
        setPromptResult(data);

        if (!data.hasQuestions && onPromptGenerated) {
          onPromptGenerated(data.optimizedPrompt);
        }
      } catch (err) {
        setPromptError(
          err instanceof Error ? err.message : 'エラーが発生しました',
        );
      } finally {
        setIsGeneratingPrompt(false);
      }
    },
    [taskId, onPromptGenerated],
  );

  const handleSubmitAnswers = useCallback(async () => {
    if (!promptResult?.clarificationQuestions) return;

    // Validate all required questions are answered before submitting
    const requiredQuestions = promptResult.clarificationQuestions.filter(
      (q) => q.isRequired,
    );
    const unansweredRequired = requiredQuestions.filter(
      (q) => !questionAnswers[q.id]?.trim(),
    );
    if (unansweredRequired.length > 0) {
      setPromptError('必須の質問に回答してください');
      return;
    }

    setIsSubmittingAnswers(true);
    setPromptError(null);

    // Convert from question-ID-keyed to question-text-keyed format as the API expects
    const clarificationAnswers: Record<string, string> = {};
    promptResult.clarificationQuestions.forEach((q) => {
      if (questionAnswers[q.id]) {
        clarificationAnswers[q.question] = questionAnswers[q.id];
      }
    });

    try {
      await generatePrompt(clarificationAnswers);
      setQuestionAnswers({});
    } finally {
      setIsSubmittingAnswers(false);
    }
  }, [promptResult, questionAnswers, generatePrompt]);

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

  const getCategoryLabel = useCallback((category: string): string => {
    const labels: Record<string, string> = {
      scope: 'スコープ',
      technical: '技術',
      requirements: '要件',
      constraints: '制約',
      integration: '統合',
      testing: 'テスト',
      deliverables: '成果物',
    };
    return labels[category] || category;
  }, []);

  return {
    isGeneratingPrompt,
    promptResult,
    promptError,
    copied,
    questionAnswers,
    isSubmittingAnswers,
    setQuestionAnswers,
    setPromptResult,
    setPromptError,
    generatePrompt,
    handleSubmitAnswers,
    handleCopyPrompt,
    handleUsePrompt,
    getCategoryLabel,
  };
}
