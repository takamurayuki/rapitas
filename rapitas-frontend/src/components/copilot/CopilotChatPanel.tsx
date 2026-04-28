'use client';

/**
 * CopilotChatPanel
 *
 * AI-powered chat panel for task assistance, analysis, and action execution.
 * Supports quick prompts, message history, and contextual insights.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { useCopilotChat } from './useCopilotChat';
import { MessageBubble, ProactiveInsight } from './CopilotChatComponents';
import {
  QUICK_PROMPTS,
  type CopilotChatPanelProps,
  type QuickPromptItem,
} from './copilot-chat-types';

export function CopilotChatPanel({
  taskId,
  taskTitle,
  taskStatus,
  taskDescription: _taskDescription,
  onTaskUpdated,
  className = '',
  embedded = false,
  children,
}: CopilotChatPanelProps) {
  const { messages, isLoading, error, sendMessage, executeAction, clearChat } =
    useCopilotChat(taskId);
  const [input, setInput] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage(input.trim());
      setInput('');
    }
  };

  const handleQuickAction = (qp: QuickPromptItem) => {
    if (qp.isAction && qp.action) executeAction(qp.action);
    else if (qp.prompt) sendMessage(qp.prompt);
  };

  const handleAction = useCallback(
    async (actionType: string, params?: Record<string, unknown>) => {
      const copilotActions = [
        'analyze',
        'execute',
        'create_subtasks',
        'update_status',
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
          <span className="text-[10px] text-zinc-400">cache→local→haiku→sonnet</span>
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              aria-label="チャットをクリア"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Trash2 className="h-3.5 w-3.5" />
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
          <div>
            <ProactiveInsight taskStatus={taskStatus} taskTitle={taskTitle} />
            <div className="grid grid-cols-2 gap-2">
              {QUICK_PROMPTS.map((qp) => (
                <button
                  key={qp.label}
                  onClick={() => handleQuickAction(qp)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    qp.isAction
                      ? 'border-indigo-200 bg-indigo-50/50 text-indigo-700 hover:border-indigo-400 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-300 dark:hover:bg-indigo-900/40'
                      : 'border-zinc-200 text-zinc-600 hover:border-indigo-300 hover:bg-indigo-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-indigo-600 dark:hover:bg-indigo-900/20'
                  }`}
                >
                  <qp.icon
                    className={`h-3.5 w-3.5 shrink-0 ${qp.isAction ? 'text-indigo-600 dark:text-indigo-400' : 'text-indigo-500'}`}
                  />
                  {qp.label}
                </button>
              ))}
            </div>
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

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-zinc-200 px-3 py-2.5 dark:border-zinc-700"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="質問や指示を入力..."
          disabled={isLoading}
          className="flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-600 dark:placeholder:text-zinc-500"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) handleSubmit(e);
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          aria-label="送信"
          className="rounded-lg bg-indigo-600 p-1.5 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>

      {/* Execution accordion and other panels injected by parent */}
      {children}
    </div>
  );
}
