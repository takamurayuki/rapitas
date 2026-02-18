'use client';
import { useState, useCallback, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Sparkles,
  Bot,
  TrendingUp,
  RefreshCw,
  Repeat,
  ArrowRight,
  Wrench,
  PlusCircle,
  Trash2,
  Clock,
} from 'lucide-react';
import type { Priority } from '@/types';
import { API_BASE_URL } from '@/utils/api';

type TaskSuggestion = {
  title: string;
  frequency: number;
  priority: string;
  estimatedHours: number | null;
  description: string | null;
  labelIds: number[];
  reason?: string | null;
  category?: 'recurring' | 'extension' | 'improvement' | 'new';
};

type AiSuggestionsResponse = {
  suggestions: TaskSuggestion[];
  analysis: string | null;
  source: 'ai' | 'ai_error' | 'insufficient_data' | 'none' | 'cache';
};

type TaskSuggestionsProps = {
  themeId: number | null;
  onApply: (suggestion: {
    title: string;
    priority: Priority;
    estimatedHours: string;
    description: string;
    labelIds: number[];
  }) => void;
};

const CATEGORY_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; color: string }
> = {
  recurring: {
    label: '定期',
    icon: <Repeat className="w-2.5 h-2.5" />,
    color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400',
  },
  extension: {
    label: '発展',
    icon: <ArrowRight className="w-2.5 h-2.5" />,
    color:
      'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400',
  },
  improvement: {
    label: '改善',
    icon: <Wrench className="w-2.5 h-2.5" />,
    color:
      'bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400',
  },
  new: {
    label: '新規',
    icon: <PlusCircle className="w-2.5 h-2.5" />,
    color:
      'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400',
  },
};

export default function TaskSuggestions({
  themeId,
  onApply,
}: TaskSuggestionsProps) {
  const [aiSuggestions, setAiSuggestions] = useState<TaskSuggestion[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isCacheLoading, setIsCacheLoading] = useState(false);
  const [aiError, setAiError] = useState(false);
  const [isCached, setIsCached] = useState(false);

  const [isExpanded, setIsExpanded] = useState(false);
  const [isListExpanded, setIsListExpanded] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // themeId変更時にキャッシュのみ自動読み込み（AI生成はしない）
  useEffect(() => {
    if (!themeId) {
      setAiSuggestions([]);
      setAiAnalysis(null);
      setIsCached(false);
      setIsExpanded(false);
      setIsCacheLoading(false);
      return;
    }

    const loadCache = async () => {
      setIsCacheLoading(true);
      try {
        const res = await fetch(
          `${API_BASE_URL}/tasks/suggestions/ai/cache?themeId=${themeId}`,
        );
        if (res.ok) {
          const data: AiSuggestionsResponse = await res.json();
          if (data.source === 'cache' && data.suggestions.length > 0) {
            setAiSuggestions(data.suggestions);
            setAiAnalysis(data.analysis);
            setIsCached(true);
            setIsExpanded(true);
            setIsCacheLoading(false);
            return;
          }
        }
      } catch (e) {
        // Cache load failure is not critical
      }
      // キャッシュが無い場合はリセット
      setAiSuggestions([]);
      setAiAnalysis(null);
      setIsCached(false);
      setIsExpanded(false);
      setIsCacheLoading(false);
    };

    loadCache();
  }, [themeId]);

  // AI提案をフェッチ（ボタン押下時のみ実行）
  const fetchAiSuggestions = useCallback(
    async (forceRefresh = false) => {
      if (!themeId) return;

      setIsAiLoading(true);
      setAiError(false);

      // キャッシュ確認（強制リフレッシュでない場合）
      if (!forceRefresh) {
        try {
          const cacheRes = await fetch(
            `${API_BASE_URL}/tasks/suggestions/ai/cache?themeId=${themeId}`,
          );
          if (cacheRes.ok) {
            const cacheData: AiSuggestionsResponse = await cacheRes.json();
            if (
              cacheData.source === 'cache' &&
              cacheData.suggestions.length > 0
            ) {
              setAiSuggestions(cacheData.suggestions);
              setAiAnalysis(cacheData.analysis);
              setIsCached(true);
              setIsAiLoading(false);
              setIsExpanded(true);
              return;
            }
          }
        } catch (e) {
          // キャッシュ取得失敗時はAI生成にフォールバック
        }
      }

      try {
        const res = await fetch(
          `${API_BASE_URL}/tasks/suggestions/ai?themeId=${themeId}&limit=5`,
        );
        if (res.ok) {
          const data: AiSuggestionsResponse = await res.json();
          if (data.source === 'ai' && data.suggestions.length > 0) {
            setAiSuggestions(data.suggestions);
            setAiAnalysis(data.analysis);
            setIsCached(false); // 新規生成なのでキャッシュフラグはfalse
            setIsExpanded(true);
          } else {
            setAiSuggestions([]);
            setAiAnalysis(null);
            if (data.source === 'ai_error') {
              setAiError(true);
            }
          }
        }
      } catch (e) {
        console.error('Failed to fetch AI suggestions:', e);
        setAiError(true);
      } finally {
        setIsAiLoading(false);
      }
    },
    [themeId],
  );

  const clearCache = useCallback(async () => {
    if (!themeId) return;

    try {
      await fetch(
        `${API_BASE_URL}/tasks/suggestions/ai/cache?themeId=${themeId}`,
        { method: 'DELETE' },
      );
    } catch (e) {
      // Ignore
    }

    setAiSuggestions([]);
    setAiAnalysis(null);
    setIsCached(false);
    setIsExpanded(false);
  }, [themeId]);

  const handleApply = (suggestion: TaskSuggestion) => {
    onApply({
      title: suggestion.title,
      priority: (suggestion.priority as Priority) ?? 'medium',
      estimatedHours: suggestion.estimatedHours?.toString() ?? '',
      description: suggestion.description ?? '',
      labelIds: suggestion.labelIds ?? [],
    });
  };

  const visibleSuggestions = isListExpanded
    ? aiSuggestions
    : aiSuggestions.slice(0, 3);

  const hasSuggestions = aiSuggestions.length > 0;
  const canExpand = hasSuggestions;

  const handleHeaderClick = () => {
    if (canExpand) {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div className="border-b border-zinc-100 dark:border-zinc-800">
      {/* Header - clickable to expand/collapse */}
      <div
        onClick={handleHeaderClick}
        className={`flex items-center justify-between px-4 py-2.5 ${
          canExpand
            ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/30'
            : ''
        } transition-colors`}
      >
        <div className="flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5 text-violet-500 dark:text-violet-400" />
          <span className="text-xs font-medium text-violet-700 dark:text-violet-300">
            AI提案
          </span>
          {isCacheLoading && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium animate-pulse">
              読み込み中...
            </span>
          )}
          {!isCacheLoading && hasSuggestions && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 font-medium">
              {isCached ? '前回の提案' : ''} {aiSuggestions.length}件
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* AI提案生成ボタン（提案がない場合のみ表示） */}
          {!isAiLoading && !hasSuggestions && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fetchAiSuggestions(false);
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400 hover:bg-violet-200 dark:hover:bg-violet-900"
              title="AI提案を取得"
            >
              <Sparkles className="w-3 h-3" />
              提案
            </button>
          )}

          {/* ローディングインジケータ */}
          {isAiLoading && (
            <div className="flex items-center gap-1 px-2 py-1">
              <Sparkles className="w-3 h-3 text-violet-400 animate-pulse" />
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                分析中...
              </span>
            </div>
          )}

          {/* 再実行ボタン（提案がある場合のみ表示） */}
          {!isAiLoading && hasSuggestions && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fetchAiSuggestions(true);
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400 hover:bg-violet-200 dark:hover:bg-violet-900"
              title="AI提案を再生成"
            >
              <RefreshCw className="w-3 h-3" />
              再実行
            </button>
          )}

          {/* キャッシュクリアボタン */}
          {!isAiLoading && isCached && hasSuggestions && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clearCache();
              }}
              className="p-1 text-zinc-400 dark:text-zinc-500 hover:text-rose-500 dark:hover:text-rose-400 transition-colors"
              title="提案をクリア"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}

          {/* 展開/折りたたみアイコン（右端） */}
          {canExpand && (
            <div className="ml-0.5 text-zinc-400 dark:text-zinc-500">
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && hasSuggestions && (
        <div className="px-4 pb-3">
          {/* Cached indicator */}
          {isCached && (
            <div className="mb-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-800/30">
              <Clock className="w-3 h-3 text-amber-500 dark:text-amber-400 shrink-0" />
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                前回のAI提案を表示しています。「再実行」で最新の提案を取得できます。
              </p>
            </div>
          )}

          {/* AI Analysis summary */}
          {aiAnalysis && (
            <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-violet-50/50 dark:bg-violet-900/10 border border-violet-100 dark:border-violet-800/30">
              <div className="flex items-start gap-1.5">
                <TrendingUp className="w-3 h-3 mt-0.5 text-violet-500 dark:text-violet-400 shrink-0" />
                <p className="text-[11px] text-violet-700 dark:text-violet-300 leading-relaxed">
                  {aiAnalysis}
                </p>
              </div>
            </div>
          )}

          {/* Suggestion items */}
          <div className="flex flex-col gap-1.5">
            {visibleSuggestions.map((suggestion, idx) => (
              <button
                key={`${suggestion.title}-${idx}`}
                type="button"
                onClick={() => handleApply(suggestion)}
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
                className="group relative w-full text-left px-3 py-2 rounded-lg text-xs transition-all border bg-white dark:bg-zinc-800/50 border-violet-200/50 dark:border-violet-800/30 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:border-violet-300 dark:hover:border-violet-700"
              >
                <div className="flex items-center gap-2">
                  {/* Category badge */}
                  {suggestion.category && (
                    <span
                      className={`shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                        CATEGORY_CONFIG[suggestion.category]?.color ??
                        CATEGORY_CONFIG.new.color
                      }`}
                    >
                      {CATEGORY_CONFIG[suggestion.category]?.icon ??
                        CATEGORY_CONFIG.new.icon}
                      {CATEGORY_CONFIG[suggestion.category]?.label ?? '新規'}
                    </span>
                  )}

                  {/* Title */}
                  <span className="font-medium text-zinc-800 dark:text-zinc-200 truncate">
                    {suggestion.title}
                  </span>
                </div>

                {/* Reason on hover */}
                {suggestion.reason && (
                  <p
                    className={`mt-1 text-[10px] text-zinc-500 dark:text-zinc-400 leading-relaxed transition-all ${
                      hoveredIndex === idx
                        ? 'max-h-20 opacity-100'
                        : 'max-h-0 opacity-0 overflow-hidden'
                    }`}
                  >
                    {suggestion.reason}
                  </p>
                )}
              </button>
            ))}
          </div>

          {/* Expand/collapse list for more than 3 items */}
          {aiSuggestions.length > 3 && (
            <div className="flex justify-end mt-1.5">
              <button
                type="button"
                onClick={() => setIsListExpanded(!isListExpanded)}
                className="text-[10px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
              >
                {isListExpanded
                  ? '閉じる'
                  : `もっと見る (${aiSuggestions.length - 3})`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Error state (shown when expanded or when no suggestions) */}
      {isExpanded && aiError && !isAiLoading && aiSuggestions.length === 0 && (
        <div className="px-4 pb-3 text-center">
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            AIキーが未設定、またはデータが不足しています
          </p>
        </div>
      )}
    </div>
  );
}
