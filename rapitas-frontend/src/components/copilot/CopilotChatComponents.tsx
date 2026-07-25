'use client';

/**
 * Copilot Chat Components
 *
 * Helper components for the copilot chat panel including tier badges,
 * analysis result cards, message bubbles, and proactive insights.
 */
import { useState, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  Loader2,
  Cpu,
  Cloud,
  Database,
  ArrowRight,
  Play,
  CheckCircle2,
  Zap,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { CopilotMessage } from './useCopilotChat';
import type { AnalysisData } from './copilot-chat-types';
import { MarkdownView } from '../markdown/MarkdownView';

/**
 * Badge showing the AI tier used (local, haiku, sonnet), the cache
 * indicator, or — for `model === 'template'` — that the answer was a
 * deterministic DB lookup that never called any model at all.
 */
export function TierBadge({
  tier,
  cached,
  model,
}: {
  tier?: string;
  cached?: boolean;
  model?: string;
}) {
  if (cached)
    return (
      <span className="text-[10px] text-emerald-500 flex items-center gap-0.5">
        <Database className="w-2.5 h-2.5" />
        cache
      </span>
    );
  if (model === 'template')
    return (
      <span className="text-[10px] text-teal-500 flex items-center gap-0.5">
        <Database className="w-2.5 h-2.5" />
        instant
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
      <span className="text-[10px] text-indigo-400 flex items-center gap-0.5">
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

/**
 * Interactive card displaying AI analysis results with selectable subtasks.
 */
export function AnalysisResultCard({
  data,
  onAction,
}: {
  data: AnalysisData;
  onAction?: (action: string, params?: Record<string, unknown>) => void;
}) {
  const t = useTranslations('copilot.chatComponents.analysisCard');
  const tPriority = useTranslations('task');
  // NOTE: memoized — `?? []` creates a new array every render when
  // suggestedSubtasks is absent, which would make the useCallbacks below
  // that depend on `subtasks` recreate (and their own effects/handlers
  // re-trigger) on every render.
  const subtasks = useMemo(() => data.suggestedSubtasks ?? [], [data.suggestedSubtasks]);
  const [selected, setSelected] = useState<number[]>(() => subtasks.map((_, i) => i));
  const [created, setCreated] = useState(false);
  const [estimateApplied, setEstimateApplied] = useState(false);

  const toggleSubtask = useCallback((index: number) => {
    setSelected((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => (prev.length === subtasks.length ? [] : subtasks.map((_, i) => i)));
  }, [subtasks]);

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
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] text-violet-600 dark:text-violet-400">
            <span className="font-medium">
              {t('complexityLabel')} {data.complexity}
            </span>
            <span>|</span>
            <span>
              {t('estimateLabel')} {data.estimatedTotalHours}h
            </span>
          </div>
          {data.estimatedTotalHours != null &&
            (estimateApplied ? (
              <span className="flex shrink-0 items-center gap-1 text-[10px] text-green-600 dark:text-green-400">
                <CheckCircle2 className="w-2.5 h-2.5" />
                {t('appliedLabel')}
              </span>
            ) : (
              <button
                onClick={() => {
                  onAction?.('update_estimate', { estimatedHours: data.estimatedTotalHours });
                  setEstimateApplied(true);
                }}
                className="shrink-0 rounded border border-violet-300 px-2 py-0.5 text-[10px] font-medium text-violet-700 transition-colors hover:bg-violet-100 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-900/30"
              >
                {t('applyEstimateButton')}
              </button>
            ))}
        </div>
        <p className="mt-1 text-xs text-zinc-700 dark:text-zinc-300 line-clamp-2">{data.summary}</p>
      </div>
      {subtasks.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              {t('suggestedSubtasksLabel', { count: subtasks.length })}
            </p>
            {!created && (
              <button
                onClick={toggleAll}
                className="text-[10px] text-violet-600 dark:text-violet-400 hover:underline"
              >
                {selected.length === subtasks.length ? t('deselectLabel') : tPriority('selectAll')}
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
                            ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
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
                      {st.priority === 'high'
                        ? tPriority('priorityHigh')
                        : st.priority === 'medium'
                          ? tPriority('priorityMedium')
                          : tPriority('priorityLow')}
                    </span>
                    {st.estimatedHours != null && (
                      <span className="text-[9px] text-zinc-500">{st.estimatedHours}h</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {!created && (
            <div className="flex items-center justify-end gap-2 pt-1">
              <span className="text-[10px] text-zinc-500">
                {t('selectedCountLabel', { count: selected.length })}
              </span>
              <button
                onClick={handleCreate}
                disabled={selected.length === 0}
                className="flex items-center gap-1 px-2 py-1 bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
              >
                <CheckCircle2 className="w-2.5 h-2.5" />
                {t('createSubtasksButton')}
              </button>
            </div>
          )}
          {created && (
            <div className="flex items-center gap-1.5 p-1.5 bg-green-50 dark:bg-green-900/20 rounded text-[10px] text-green-700 dark:text-green-300">
              <CheckCircle2 className="w-3 h-3" />
              {t('subtasksCreatedMessage')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Single chat message bubble with optional action buttons.
 */
export function MessageBubble({
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
        ) : isUser ? (
          // User input is plain text, not markdown.
          <p className="whitespace-pre-wrap">{msg.content}</p>
        ) : (
          // Assistant content (incl. the retrospective) is markdown — render it
          // with the same styling as the workflow file viewer.
          <MarkdownView content={msg.content} />
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
            <TierBadge tier={msg.tier} cached={msg.cached} model={msg.model} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Contextual insight message based on task status.
 */
export function ProactiveInsight({
  taskStatus,
  taskTitle,
}: {
  taskStatus?: string;
  taskTitle?: string;
}) {
  const t = useTranslations('copilot.chatComponents.proactiveInsight');
  if (!taskStatus || !taskTitle) return null;

  const insights: Array<{ icon: typeof Zap; text: string; color: string }> = [];

  if (taskStatus === 'todo')
    insights.push({
      icon: Zap,
      text: t('todoInsight'),
      color: 'text-amber-500',
    });
  else if (taskStatus === 'in-progress')
    insights.push({
      icon: ArrowRight,
      text: t('inProgressInsight'),
      color: 'text-indigo-500',
    });
  else if (taskStatus === 'done' || taskStatus === 'completed')
    insights.push({
      icon: CheckCircle2,
      text: t('doneInsight'),
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
