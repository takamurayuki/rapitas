'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Loader2,
  Sparkles,
  Trash2,
  Cpu,
  Cloud,
  Database,
  ListTodo,
  ArrowRight,
  AlertTriangle,
  Lightbulb,
  Play,
  CheckCircle2,
  Clock,
  Zap,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useCopilotChat, type CopilotMessage } from './useCopilotChat';

interface CopilotChatPanelProps {
  taskId?: number;
  taskTitle?: string;
  taskStatus?: string;
  taskDescription?: string | null;
  onTaskUpdated?: () => void;
  className?: string;
  embedded?: boolean;
  /** Content rendered below the input bar, inside the same card (e.g. execution accordion). */
  children?: React.ReactNode;
}

const QUICK_PROMPTS = [
  {
    icon: Sparkles,
    label: 'AI分析',
    action: 'analyze' as const,
    isAction: true,
  },
  {
    icon: ListTodo,
    label: 'サブタスク分解',
    prompt: 'このタスクを具体的なサブタスクに分解してください',
  },
  {
    icon: AlertTriangle,
    label: 'リスク分析',
    prompt: 'このタスクの潜在的なリスクと対策を教えてください',
  },
  {
    icon: Clock,
    label: '工数見積もり',
    prompt: 'このタスクの実装工数を見積もってください',
  },
  {
    icon: Play,
    label: 'エージェント実行',
    action: 'execute' as const,
    isAction: true,
  },
  {
    icon: Lightbulb,
    label: 'アプローチ提案',
    prompt: 'このタスクの最適なアプローチを提案してください',
  },
];

type AnalysisData = {
  summary: string;
  complexity: string;
  estimatedTotalHours: number;
  suggestedSubtasks: Array<{
    title: string;
    description?: string;
    priority: string;
    estimatedHours?: number;
  }>;
};

function TierBadge({ tier, cached }: { tier?: string; cached?: boolean }) {
  if (cached)
    return (
      <span className="text-[10px] text-emerald-500 flex items-center gap-0.5">
        <Database className="w-2.5 h-2.5" />
        cache
      </span>
    );
  if (tier === 'free')
    return (
      <span className="text-[10px] text-green-500 flex items-center gap-0.5">
        <Cpu className="w-2.5 h-2.5" />
        local
      </span>
    );
  if (tier === 'economy')
    return (
      <span className="text-[10px] text-blue-400 flex items-center gap-0.5">
        <Cloud className="w-2.5 h-2.5" />
        haiku
      </span>
    );
  if (tier === 'standard')
    return (
      <span className="text-[10px] text-purple-400 flex items-center gap-0.5">
        <Cloud className="w-2.5 h-2.5" />
        sonnet
      </span>
    );
  return null;
}

function AnalysisResultCard({
  data,
  onAction,
}: {
  data: AnalysisData;
  onAction?: (action: string, params?: Record<string, unknown>) => void;
}) {
  const subtasks = data.suggestedSubtasks ?? [];
  const [selected, setSelected] = useState<number[]>(() => subtasks.map((_, i) => i));
  const [created, setCreated] = useState(false);

  const toggleSubtask = useCallback((index: number) => {
    setSelected((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => (prev.length === subtasks.length ? [] : subtasks.map((_, i) => i)));
  }, [subtasks.length]);

  const handleCreate = useCallback(() => {
    const selectedSubs = selected.map((i) => ({
      title: subtasks[i].title,
      description: subtasks[i].description,
    }));
    onAction?.('create_subtasks', { subtasks: selectedSubs });
    setCreated(true);
  }, [selected, subtasks, onAction]);

  return (
    <div className="mt-2 space-y-2">
      <div className="rounded-lg bg-violet-50/70 px-3 py-2 dark:bg-violet-900/20">
        <div className="flex items-center gap-2 text-[11px] text-violet-600 dark:text-violet-400">
          <span className="font-medium">複雑度: {data.complexity}</span>
          <span>|</span>
          <span>推定: {data.estimatedTotalHours}h</span>
        </div>
        <p className="mt-1 text-xs text-zinc-700 dark:text-zinc-300 line-clamp-2">{data.summary}</p>
      </div>
      {subtasks.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              提案サブタスク ({subtasks.length}件)
            </p>
            {!created && (
              <button
                onClick={toggleAll}
                className="text-[10px] text-violet-600 dark:text-violet-400 hover:underline"
              >
                {selected.length === subtasks.length ? '解除' : '全選択'}
              </button>
            )}
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {subtasks.map((st, i) => (
              <div
                key={i}
                onClick={() => !created && toggleSubtask(i)}
                className={`p-1.5 rounded text-xs flex items-start gap-1.5 bg-violet-50 dark:bg-violet-900/20 ${!created ? 'cursor-pointer hover:bg-violet-100 dark:hover:bg-violet-900/30' : ''}`}
              >
                {!created && (
                  <input
                    type="checkbox"
                    checked={selected.includes(i)}
                    onChange={() => {}}
                    className="mt-0.5 w-3 h-3 rounded border-violet-300 text-violet-600"
                  />
                )}
                {created && <CheckCircle2 className="w-3 h-3 mt-0.5 text-green-500 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-violet-700 dark:text-violet-300 text-[11px] line-clamp-1">
                    {st.title}
                  </span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span
                      className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] ${
                        st.priority === 'high'
                          ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                          : st.priority === 'medium'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}
                    >
                      {st.priority === 'high' ? (
                        <ChevronUp className="w-2.5 h-2.5" />
                      ) : st.priority === 'medium' ? (
                        <span className="w-2.5 h-2.5 inline-flex items-center justify-center">
                          ↕
                        </span>
                      ) : (
                        <ChevronDown className="w-2.5 h-2.5" />
                      )}
                      {st.priority === 'high' ? '高' : st.priority === 'medium' ? '中' : '低'}
                    </span>
                    {st.estimatedHours != null && (
                      <span className="text-[9px] text-zinc-400">{st.estimatedHours}h</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {!created && (
            <div className="flex items-center justify-end gap-2 pt-1">
              <span className="text-[10px] text-zinc-500">{selected.length}件選択</span>
              <button
                onClick={handleCreate}
                disabled={selected.length === 0}
                className="flex items-center gap-1 px-2 py-1 bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
              >
                <CheckCircle2 className="w-2.5 h-2.5" />
                サブタスクを作成
              </button>
            </div>
          )}
          {created && (
            <div className="flex items-center gap-1.5 p-1.5 bg-green-50 dark:bg-green-900/20 rounded text-[10px] text-green-700 dark:text-green-300">
              <CheckCircle2 className="w-3 h-3" />
              サブタスクを作成しました
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  msg,
  onAction,
}: {
  msg: CopilotMessage;
  onAction?: (action: string, params?: Record<string, unknown>) => void;
}) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center mb-3">
        <div className="flex items-center gap-2 rounded-full bg-indigo-50 px-4 py-1.5 text-xs text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
          <Loader2 className="h-3 w-3 animate-spin" />
          {msg.content}
        </div>
      </div>
    );
  }

  const isAnalysis = msg.actionData?.type === 'analyze' && msg.actionData.data;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[92%] sm:max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${isUser ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'}`}
      >
        {isAnalysis ? (
          <AnalysisResultCard data={msg.actionData!.data as AnalysisData} onAction={onAction} />
        ) : (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        )}
        {!isUser && !isAnalysis && (
          <div className="mt-2 flex items-center justify-between">
            {msg.actions && msg.actions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {msg.actions.map((action, i) => (
                  <button
                    key={i}
                    onClick={() => onAction?.(action.type, action.params)}
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
  const insights: Array<{ icon: typeof Zap; text: string; color: string }> = [];
  if (taskStatus === 'todo')
    insights.push({
      icon: Zap,
      text: '着手前です。アプローチの壁打ちをしませんか？',
      color: 'text-amber-500',
    });
  else if (taskStatus === 'in_progress')
    insights.push({
      icon: ArrowRight,
      text: '進行中です。詰まっている点はありませんか？',
      color: 'text-blue-500',
    });
  else if (taskStatus === 'done' || taskStatus === 'completed')
    insights.push({
      icon: CheckCircle2,
      text: '完了済みです。振り返りを行いますか？',
      color: 'text-emerald-500',
    });
  if (insights.length === 0) return null;
  return (
    <div className="mb-3 space-y-1.5">
      {insights.map((insight, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-800/50"
        >
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

  const handleQuickAction = (qp: (typeof QUICK_PROMPTS)[number]) => {
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
