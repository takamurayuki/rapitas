'use client';

/**
 * CopilotChatPanel
 *
 * AI-powered chat panel for task assistance, analysis, and action execution.
 * Supports quick prompts, message history, and contextual insights.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2, Sparkles, RotateCcw } from 'lucide-react';
import { useCopilotChat } from './useCopilotChat';
import { MessageBubble, ProactiveInsight } from './CopilotChatComponents';
import { type CopilotChatPanelProps } from './copilot-chat-types';
import { getNextActions, type RecommendedAction } from './next-action-recommender';
import { NextActionRecommendations } from './NextActionRecommendations';

export function CopilotChatPanel({
  taskId,
  taskTitle,
  taskStatus,
  taskDescription: _taskDescription,
  onTaskUpdated,
  nextActionContext,
  className = '',
  embedded = false,
  children,
}: CopilotChatPanelProps) {
  const { messages, isLoading, error, sendMessage, executeAction, runRetrospective, clearChat } =
    useCopilotChat(taskId);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nextActions = nextActionContext ? getNextActions(nextActionContext) : [];

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleAction = useCallback(
    async (actionType: string, params?: Record<string, unknown>) => {
      const copilotActions = [
        'analyze',
        'execute',
        'create_subtasks',
        'update_status',
        'update_estimate',
        'get_execution_status',
      ];
      if (copilotActions.includes(actionType)) {
        await executeAction(actionType, params);
        onTaskUpdated?.();
        return;
      }
      if (actionType === 'start_task' && taskId) {
        await executeAction('update_status', { status: 'in_progress' });
        onTaskUpdated?.();
      } else if (actionType === 'complete_task' && taskId) {
        await executeAction('update_status', { status: 'done' });
        onTaskUpdated?.();
      }
    },
    [taskId, onTaskUpdated, executeAction],
  );

  // A recommendation is either a one-click action or a chat prompt (e.g. the
  // post-completion retrospective). Dispatch to the right handler.
  const handleSelect = useCallback(
    (action: RecommendedAction) => {
      if (action.runRetrospective) {
        runRetrospective();
      } else if (action.prompt) {
        sendMessage(action.prompt);
      } else if (action.actionType) {
        handleAction(action.actionType, action.params);
      }
    },
    [runRetrospective, sendMessage, handleAction],
  );

  if (isCollapsed && !embedded) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className={`flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800 ${className}`}
      >
        <Sparkles className="h-4 w-4 text-indigo-500" />
        <span className="font-medium text-zinc-700 dark:text-zinc-300">AI コパイロット</span>
        {messages.length > 0 && (
          <span className="rounded-full bg-indigo-100 px-1.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
            {messages.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className={
        embedded
          ? `flex flex-col ${className}`
          : `flex flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 ${className}`
      }
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            AI コパイロット
          </h3>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              aria-label="最初に戻る"
              title="会話を最初に戻す"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        className="flex-1 overflow-y-auto px-4 py-3"
        style={{ minHeight: '200px', maxHeight: 'calc(100vh - 16rem)' }}
      >
        {messages.length === 0 && !isLoading && (
          <ProactiveInsight taskStatus={taskStatus} taskTitle={taskTitle} />
        )}
        {nextActions.length > 0 && (
          <div className="mb-3">
            <NextActionRecommendations
              actions={nextActions}
              onSelect={handleSelect}
              isBusy={isLoading}
            />
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} onAction={handleAction} />
        ))}
        {isLoading && (
          <div className="flex justify-start mb-3">
            <div className="rounded-xl bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
              <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
            </div>
          </div>
        )}
        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* Execution accordion and other panels injected by parent */}
      {children}
    </div>
  );
}
