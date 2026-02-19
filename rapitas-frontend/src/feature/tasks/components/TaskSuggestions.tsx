'use client';
import { useState, useCallback, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Sparkles,
  RefreshCw,
  Repeat,
  ArrowRight,
  Wrench,
  PlusCircle,
  Trash2,
  Clock,
  Info,
  CheckCircle2,
  Target,
  BarChart3,
  X,
} from 'lucide-react';
import type { Priority, UserSettings } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import TaskSuggestionDetail from './TaskSuggestionDetail';

type TaskSuggestion = {
  title: string;
  frequency: number;
  priority: string;
  estimatedHours: number | null;
  description: string | null;
  labelIds: number[];
  reason?: string | null;
  category?: 'recurring' | 'extension' | 'improvement' | 'new';
  completionCriteria?: string | null;
  measurableOutcome?: string | null;
  dependencies?: string | null;
  suggestedApproach?: string | null;
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
  const [aiError, setAiError] = useState(false);
  const [isCached, setIsCached] = useState(false);

  const [isExpanded, setIsExpanded] = useState(false);
  const [isListExpanded, setIsListExpanded] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<TaskSuggestion | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [deletedIndices, setDeletedIndices] = useState<Set<number>>(new Set());

  // themeId変更時の処理 - 自動読み込みを削除
  useEffect(() => {
    console.log('[TaskSuggestions] Theme changed to:', themeId);

    if (!themeId) {
      // テーマが選択されていない場合はリセット
      setAiSuggestions([]);
      setAiAnalysis(null);
      setIsCached(false);
      setIsExpanded(false);
      setDeletedIndices(new Set());
      setAiError(false);
    }
  }, [themeId]);

  // AI提案をフェッチ（ボタン押下時のみ実行）
  const fetchAiSuggestions = useCallback(
    async (forceRefresh = false) => {
      if (!themeId) return;

      console.log('[TaskSuggestions] Fetching AI suggestions, forceRefresh:', forceRefresh);
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
              console.log('[TaskSuggestions] Using cached suggestions');
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
          console.error('[TaskSuggestions] Cache fetch error:', e);
        }
      }

      try {
        console.log('[TaskSuggestions] Generating new AI suggestions');
        const res = await fetch(
          `${API_BASE_URL}/tasks/suggestions/ai?themeId=${themeId}&limit=5`,
        );
        if (res.ok) {
          const data: AiSuggestionsResponse = await res.json();
          console.log('[TaskSuggestions] AI generation response:', data.source, 'suggestions:', data.suggestions.length);

          if (data.source === 'ai' && data.suggestions.length > 0) {
            setAiSuggestions(data.suggestions);
            setAiAnalysis(data.analysis);
            setIsCached(false); // 新規生成なのでキャッシュフラグはfalse
            setIsExpanded(true);
          } else {
            setAiSuggestions([]);
            setAiAnalysis(null);
            if (data.source === 'ai_error' || data.source === 'insufficient_data') {
              console.log('[TaskSuggestions] AI generation failed:', data.source);
              setAiError(true);
            }
          }
        }
      } catch (e) {
        console.error('[TaskSuggestions] Failed to fetch AI suggestions:', e);
        setAiError(true);
      } finally {
        setIsAiLoading(false);
      }
    },
    [themeId],
  );

  const clearCache = useCallback(async () => {
    if (!themeId) return;

    console.log('[TaskSuggestions] Clearing cache for theme:', themeId);

    try {
      await fetch(
        `${API_BASE_URL}/tasks/suggestions/ai/cache?themeId=${themeId}`,
        { method: 'DELETE' },
      );
    } catch (e) {
      console.error('[TaskSuggestions] Failed to clear cache:', e);
    }

    setAiSuggestions([]);
    setAiAnalysis(null);
    setIsCached(false);
    setIsExpanded(false);
  }, [themeId]);

  const handleApply = (suggestion: TaskSuggestion) => {
    // 詳細情報がある場合は、完了条件などを説明に追加
    let enhancedDescription = suggestion.description ?? '';

    if (suggestion.completionCriteria) {
      enhancedDescription += '\n\n【完了条件】\n' + suggestion.completionCriteria;
    }

    if (suggestion.measurableOutcome) {
      enhancedDescription += '\n\n【測定可能な成果】\n' + suggestion.measurableOutcome;
    }

    onApply({
      title: suggestion.title,
      priority: (suggestion.priority as Priority) ?? 'medium',
      estimatedHours: suggestion.estimatedHours?.toString() ?? '',
      description: enhancedDescription.trim(),
      labelIds: suggestion.labelIds ?? [],
    });

    setShowDetail(false);
    setSelectedSuggestion(null);
  };

  const handleSuggestionClick = (suggestion: TaskSuggestion) => {
    setSelectedSuggestion(suggestion);
    setShowDetail(true);
  };

  const filteredSuggestions = aiSuggestions.filter((_, idx) => !deletedIndices.has(idx));
  const visibleSuggestions = isListExpanded
    ? filteredSuggestions
    : filteredSuggestions.slice(0, 3);

  const hasSuggestions = filteredSuggestions.length > 0;
  const canExpand = hasSuggestions;

  const handleHeaderClick = () => {
    if (canExpand) {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800/50">
      {/* Compact Header */}
      <div
        onClick={handleHeaderClick}
        className={`flex items-center justify-between px-3 py-1.5 ${
          canExpand
            ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/30'
            : ''
        } transition-all duration-200`}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-violet-500 dark:text-violet-400" />
            <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              AIタスク提案
            </span>
          </div>
          {hasSuggestions && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-semibold">
              {filteredSuggestions.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* AI提案生成ボタン（コンパクトデザイン） */}
          {!isAiLoading && !hasSuggestions && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDeletedIndices(new Set());
                fetchAiSuggestions(false);
              }}
              className="group flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-all duration-200 bg-gradient-to-r from-violet-500 to-indigo-500 text-white hover:from-violet-600 hover:to-indigo-600 shadow-sm hover:shadow-md transform hover:scale-105"
              title="AI提案を生成"
            >
              <Sparkles className="w-3 h-3 group-hover:rotate-12 transition-transform duration-200" />
              <span>提案を生成</span>
            </button>
          )}

          {/* ローディング状態 */}
          {isAiLoading && (
            <div className="flex items-center gap-1 px-2 py-0.5">
              <RefreshCw className="w-3 h-3 text-violet-500 dark:text-violet-400 animate-spin" />
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">
                分析中...
              </span>
            </div>
          )}

          {/* アクションボタン（提案がある場合） */}
          {!isAiLoading && hasSuggestions && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeletedIndices(new Set());
                  fetchAiSuggestions(true);
                }}
                className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-violet-600 dark:hover:text-violet-400 transition-all duration-200"
                title="再生成"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearCache();
                  setDeletedIndices(new Set());
                }}
                className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 dark:text-zinc-500 hover:text-rose-500 dark:hover:text-rose-400 transition-all duration-200"
                title="クリア"
              >
                <X className="w-3 h-3" />
              </button>
            </>
          )}

          {/* 展開アイコン */}
          {canExpand && (
            <div className={`transition-transform duration-200 text-zinc-400 dark:text-zinc-500 ${isExpanded ? 'rotate-180' : ''}`}>
              <ChevronDown className="w-3 h-3" />
            </div>
          )}
        </div>
      </div>

      {/* Expanded content with animation */}
      <div
        className={`overflow-hidden transition-all duration-300 ${
          isExpanded && hasSuggestions ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-3 pb-2 pt-1">
          {/* AI Analysis - ultra compact */}
          {aiAnalysis && (
            <div className="mb-2 px-2 py-0.5 rounded bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-900/10 dark:to-indigo-900/10">
              <p className="text-[10px] text-zinc-600 dark:text-zinc-400 leading-snug text-center italic">
                {aiAnalysis}
              </p>
            </div>
          )}

          {/* Compact suggestion cards */}
          <div className="space-y-1">
            {visibleSuggestions.map((suggestion, visIdx) => {
              const realIdx = aiSuggestions.findIndex(s => s === suggestion);
              return (
                <div
                  key={`${suggestion.title}-${realIdx}`}
                  className="group relative rounded-lg bg-white dark:bg-zinc-900/30 border border-zinc-200/60 dark:border-zinc-700/40 hover:border-violet-300 dark:hover:border-violet-500 transition-all duration-200 hover:shadow-sm"
                >
                  <div className="flex items-center gap-2 p-2">
                    {/* Compact content */}
                    <div className="flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => handleSuggestionClick(suggestion)}
                        className="w-full text-left group"
                      >
                        <div className="flex items-center gap-1.5">
                          {/* Ultra compact badges */}
                          {suggestion.category && (
                            <span
                              className={`shrink-0 flex items-center gap-0.5 px-1 py-px rounded text-[8px] font-semibold ${
                                CATEGORY_CONFIG[suggestion.category]?.color ??
                                CATEGORY_CONFIG.new.color
                              }`}
                            >
                              {CATEGORY_CONFIG[suggestion.category]?.icon}
                              <span className="hidden sm:inline">
                                {CATEGORY_CONFIG[suggestion.category]?.label}
                              </span>
                            </span>
                          )}

                          {/* Title with inline metadata */}
                          <h4 className="font-medium text-xs text-zinc-800 dark:text-zinc-200 leading-tight flex-1 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                            {suggestion.title}
                          </h4>

                          {/* Compact time */}
                          {suggestion.estimatedHours && (
                            <span className="shrink-0 text-[9px] text-zinc-500 dark:text-zinc-400 font-medium">
                              {suggestion.estimatedHours}h
                            </span>
                          )}

                          {/* Priority dot */}
                          {(suggestion.priority === 'urgent' || suggestion.priority === 'high') && (
                            <span className="shrink-0 w-1 h-1 rounded-full bg-rose-500 dark:bg-rose-400 animate-pulse" />
                          )}
                        </div>

                        {/* Mini indicators row */}
                        <div className="flex items-center gap-1 mt-0.5">
                          {suggestion.measurableOutcome && (
                            <BarChart3 className="w-2.5 h-2.5 text-violet-400" />
                          )}
                          {suggestion.completionCriteria && (
                            <CheckCircle2 className="w-2.5 h-2.5 text-green-500" />
                          )}
                          {suggestion.dependencies && (
                            <Target className="w-2.5 h-2.5 text-amber-500" />
                          )}
                        </div>
                      </button>
                    </div>

                    {/* Compact action buttons */}
                    <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleApply(suggestion);
                        }}
                        className="p-1 bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white rounded transition-all duration-200 hover:scale-110"
                        title="作成"
                      >
                        <PlusCircle className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletedIndices(prev => new Set(prev).add(realIdx));
                        }}
                        className="p-1 text-zinc-400 hover:text-rose-500 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all duration-200"
                        title="削除"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Show more button */}
          {filteredSuggestions.length > 3 && (
            <button
              type="button"
              onClick={() => setIsListExpanded(!isListExpanded)}
              className="mt-1.5 w-full py-0.5 text-[9px] text-zinc-500 dark:text-zinc-400 hover:text-violet-600 dark:hover:text-violet-400 font-medium transition-colors duration-200"
            >
              {isListExpanded
                ? '折りたたむ'
                : `他 ${filteredSuggestions.length - 3} 件を表示`}
            </button>
          )}

          {/* Cache indicator */}
          {isCached && (
            <div className="mt-1 text-center">
              <span className="text-[8px] text-zinc-400 dark:text-zinc-500">
                キャッシュ済み
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Error state - compact */}
      {aiError && !isAiLoading && aiSuggestions.length === 0 && (
        <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800/50">
          <div className="flex items-center justify-center gap-1.5 text-zinc-500 dark:text-zinc-400">
            <Info className="w-3 h-3" />
            <p className="text-[10px]">
              AI提案の生成に失敗しました
            </p>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetail && selectedSuggestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setShowDetail(false);
              setSelectedSuggestion(null);
            }}
          />
          <div className="relative bg-white dark:bg-zinc-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                タスクの詳細
              </h2>
              <button
                onClick={() => {
                  setShowDetail(false);
                  setSelectedSuggestion(null);
                }}
                className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6">
              <TaskSuggestionDetail
                suggestion={selectedSuggestion}
                onApply={() => handleApply(selectedSuggestion)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
