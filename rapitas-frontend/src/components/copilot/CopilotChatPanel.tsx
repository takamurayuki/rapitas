'use client';
// CopilotChatPanel — autonomous AI copilot with proactive suggestions + action execution.
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Loader2, Sparkles, Trash2, Cpu, Cloud, Database,
  ListTodo, ArrowRight, AlertTriangle, Lightbulb, Play,
  CheckCircle2, Clock, Zap,
} from 'lucide-react';
import { useCopilotChat, type CopilotMessage } from './useCopilotChat';
import { API_BASE_URL } from '@/utils/api';

interface CopilotChatPanelProps {
  taskId?: number;
  taskTitle?: string;
  taskStatus?: string;
  taskDescription?: string | null;
  onTaskUpdated?: () => void;
  className?: string;
}

// Quick action buttons that the copilot can suggest
const QUICK_PROMPTS = [
  { icon: Lightbulb, label: 'アプローチ提案', prompt: 'このタスクの最適なアプローチを提案してください' },
  { icon: ListTodo, label: 'サブタスク分解', prompt: 'このタスクを具体的なサブタスクに分解してください' },
  { icon: AlertTriangle, label: 'リスク分析', prompt: 'このタスクの潜在的なリスクと対策を教えてください' },
  { icon: Clock, label: '工数見積もり', prompt: 'このタスクの実装工数を見積もってください' },
];

function TierBadge({ tier, cached }: { tier?: string; cached?: boolean }) {
  if (cached) return <span className="text-[10px] text-emerald-500 flex items-center gap-0.5"><Database className="w-2.5 h-2.5" />cache</span>;
  if (tier === 'free') return <span className="text-[10px] text-green-500 flex items-center gap-0.5"><Cpu className="w-2.5 h-2.5" />local</span>;
  if (tier === 'economy') return <span className="text-[10px] text-blue-400 flex items-center gap-0.5"><Cloud className="w-2.5 h-2.5" />haiku</span>;
  if (tier === 'standard') return <span className="text-[10px] text-purple-400 flex items-center gap-0.5"><Cloud className="w-2.5 h-2.5" />sonnet</span>;
  return null;
}

function MessageBubble({ msg, onAction }: { msg: CopilotMessage; onAction?: (action: string) => void }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
        isUser
          ? 'bg-indigo-600 text-white'
          : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'
      }`}>
        <p className="whitespace-pre-wrap">{msg.content}</p>
        {!isUser && (
          <div className="mt-2 flex items-center justify-between">
            {msg.actions && msg.actions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {msg.actions.map((action, i) => (
                  <button
                    key={i}
                    onClick={() => onAction?.(action.type)}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                  >
                    <Play className="h-2.5 w-2.5" />
                    {action.label}
                  </button>
                ))}
              </div>
            )}
            <TierBadge tier={msg.tier} cached={msg.cached} />
          </div>
        )}
      </div>
    </div>
  );
}

function ProactiveInsight({ taskStatus, taskTitle }: { taskStatus?: string; taskTitle?: string }) {
  if (!taskStatus || !taskTitle) return null;

  const insights = [];
  if (taskStatus === 'todo') {
    insights.push({ icon: Zap, text: '着手前です。アプローチの壁打ちをしませんか？', color: 'text-amber-500' });
  } else if (taskStatus === 'in_progress') {
    insights.push({ icon: ArrowRight, text: '進行中です。詰まっている点はありませんか？', color: 'text-blue-500' });
  } else if (taskStatus === 'done' || taskStatus === 'completed') {
    insights.push({ icon: CheckCircle2, text: '完了済みです。振り返りを行いますか？', color: 'text-emerald-500' });
  }

  if (insights.length === 0) return null;

  return (
    <div className="mb-3 space-y-1.5">
      {insights.map((insight, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-800/50">
          <insight.icon className={`h-3.5 w-3.5 ${insight.color}`} />
          <span className="text-zinc-600 dark:text-zinc-400">{insight.text}</span>
        </div>
      ))}
    </div>
  );
}

export function CopilotChatPanel({
  taskId,
  taskTitle,
  taskStatus,
  taskDescription,
  onTaskUpdated,
  className = '',
}: CopilotChatPanelProps) {
  const { messages, isLoading, error, sendMessage, clearChat } = useCopilotChat(taskId);
  const [input, setInput] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage(input.trim());
      setInput('');
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    sendMessage(prompt);
  };

  const handleAction = useCallback(async (actionType: string) => {
    if (actionType === 'start_task' && taskId) {
      await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      });
      onTaskUpdated?.();
    } else if (actionType === 'complete_task' && taskId) {
      await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      });
      onTaskUpdated?.();
    }
  }, [taskId, onTaskUpdated]);

  if (isCollapsed) {
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
    <div className={`flex flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-700">
        <button
          onClick={() => setIsCollapsed(true)}
          className="flex items-center gap-2 hover:opacity-80"
        >
          <Sparkles className="h-4 w-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            AI コパイロット
          </h3>
        </button>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-zinc-400">cache→local→haiku→sonnet</span>
          {messages.length > 0 && (
            <button onClick={clearChat} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="クリア">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3" style={{ minHeight: '180px', maxHeight: '400px' }}>
        {messages.length === 0 && !isLoading && (
          <div>
            <ProactiveInsight taskStatus={taskStatus} taskTitle={taskTitle} />

            {/* Quick action buttons */}
            <div className="grid grid-cols-2 gap-2">
              {QUICK_PROMPTS.map((qp) => (
                <button
                  key={qp.label}
                  onClick={() => handleQuickPrompt(qp.prompt)}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-left text-xs text-zinc-600 hover:border-indigo-300 hover:bg-indigo-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-indigo-600 dark:hover:bg-indigo-900/20"
                >
                  <qp.icon className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
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

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-zinc-200 px-3 py-2.5 dark:border-zinc-700">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="質問や指示を入力..."
          disabled={isLoading}
          className="flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-600 dark:placeholder:text-zinc-500"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleSubmit(e); }}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="rounded-lg bg-indigo-600 p-1.5 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
