/**
 * useAgentExecutionQuestion
 *
 * Question detection/parsing, timeout countdown, and the shared
 * execution-state-store publish/cleanup effects used by useAgentExecution.
 * Extracted from the hook file to keep it under the size limit; behavior is
 * unchanged.
 */
import { useEffect, useMemo, useState } from 'react';
import { useExecutionStateStore } from '@/stores/execution-state-store';
import { computeQuestionState, parseQuestionWithDetails } from './useAgentExecution.helpers';
import type { QuestionType } from './agent-execution-types';
import type { ParsedQuestion } from './agent-execution-utils';

export interface UseAgentExecutionQuestionArgs {
  taskId: number;
  sessionId: number | null;
  isTerminalStatus: boolean;
  isWaitingForInput: boolean;
  pollingWaitingForInput: boolean | undefined;
  pollingQuestion: string | undefined;
  pollingQuestionType: string | undefined;
  pollingQuestionDetails:
    | {
        options?: { label: string; description?: string }[];
        headers?: string[];
        multiSelect?: boolean;
      }
    | null
    | undefined;
  pollingQuestionTimeout: { remainingSeconds: number; deadline: string } | null | undefined;
  /** Translator (scoped to `devMode.parseQuestionOptions`). */
  tQuestionOptions: (key: string) => string;
}

export interface UseAgentExecutionQuestionReturn {
  hasQuestion: boolean;
  question: string;
  questionType: QuestionType;
  questionParsed: ParsedQuestion | null;
  hasOptions: boolean;
  isConfirmedQuestion: boolean;
  timeoutCountdown: number | null;
  /** Clears the countdown immediately (used on task change). / タスク切替時にカウントダウンを即時クリアする */
  resetTimeoutCountdown: () => void;
}

/**
 * Derives the current agent question (if any) and keeps the shared
 * execution-state store in sync so the workflow Q&A tab (a different
 * subtree with no shared parent) can render the live question.
 *
 * @param args - polling/session state needed to detect and parse the question / 質問検出・解析に必要なポーリング/セッション状態
 * @returns question state plus the countdown until the question times out / 質問の状態とタイムアウトまでの秒数
 */
export function useAgentExecutionQuestion(
  args: UseAgentExecutionQuestionArgs,
): UseAgentExecutionQuestionReturn {
  const {
    taskId,
    sessionId,
    isTerminalStatus,
    isWaitingForInput,
    pollingWaitingForInput,
    pollingQuestion,
    pollingQuestionType,
    pollingQuestionDetails,
    pollingQuestionTimeout,
    tQuestionOptions,
  } = args;

  const [timeoutCountdown, setTimeoutCountdown] = useState<number | null>(null);

  // NOTE: Question detection uses only API state
  const { hasQuestion, question, questionType } = useMemo(
    () =>
      computeQuestionState(
        isTerminalStatus,
        pollingWaitingForInput ?? false,
        pollingQuestion,
        pollingQuestionType,
      ),
    [pollingWaitingForInput, pollingQuestion, pollingQuestionType, isTerminalStatus],
  );

  // NOTE: Prefer structured questionDetails from AskUserQuestion tool calls over text parsing
  const questionParsed = useMemo(
    () => parseQuestionWithDetails(question, pollingQuestionDetails, tQuestionOptions),
    [question, pollingQuestionDetails, tQuestionOptions],
  );
  const hasOptions = !!(questionParsed && questionParsed.options.length >= 2);
  const isConfirmedQuestion = questionType === 'tool_call';

  // Question timeout countdown
  useEffect(() => {
    if (!isWaitingForInput || !pollingQuestionTimeout) {
      setTimeoutCountdown(null);
      return;
    }
    setTimeoutCountdown(pollingQuestionTimeout.remainingSeconds);
    const interval = setInterval(() => {
      setTimeoutCountdown((prev) => (prev === null || prev <= 0 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isWaitingForInput, pollingQuestionTimeout]);

  // Publish the live question to the shared store so the workflow Q&A tab can
  // render it (the Q&A tab lives in a different subtree with no shared parent).
  // Cleared when not waiting; the store de-dupes so this is safe on every poll.
  const setLiveQuestion = useExecutionStateStore((s) => s.setLiveQuestion);
  useEffect(() => {
    if (isWaitingForInput && hasQuestion) {
      setLiveQuestion(taskId, {
        taskId,
        text: questionParsed?.text ?? question,
        options: questionParsed?.options ?? [],
        sessionId: sessionId ?? undefined,
        timeoutDeadline: pollingQuestionTimeout?.deadline ?? null,
        confirmed: isConfirmedQuestion,
      });
    } else {
      setLiveQuestion(taskId, null);
    }
  }, [
    isWaitingForInput,
    hasQuestion,
    taskId,
    question,
    questionParsed,
    sessionId,
    pollingQuestionTimeout,
    isConfirmedQuestion,
    setLiveQuestion,
  ]);
  // Clear the published question when this hook unmounts (task view closed).
  useEffect(() => () => setLiveQuestion(taskId, null), [taskId, setLiveQuestion]);

  return {
    hasQuestion,
    question,
    questionType,
    questionParsed,
    hasOptions,
    isConfirmedQuestion,
    timeoutCountdown,
    resetTimeoutCountdown: () => setTimeoutCountdown(null),
  };
}
