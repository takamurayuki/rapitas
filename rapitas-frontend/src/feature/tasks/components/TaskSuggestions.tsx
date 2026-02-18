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
  Info,
  CheckCircle2,
  Target,
  BarChart3,
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
  const [isCacheLoading, setIsCacheLoading] = useState(false);
  const [aiError, setAiError] = useState(false);
  const [isCached, setIsCached] = useState(false);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [hasAutoFetchedForTheme, setHasAutoFetchedForTheme] = useState<Set<number>>(new Set());

  const [isExpanded, setIsExpanded] = useState(false);
  const [isListExpanded, setIsListExpanded] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState<TaskSuggestion | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // ユーザー設定を取得
  useEffect(() => {
    const fetchUserSettings = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/settings`);
        if (res.ok) {
          setUserSettings(await res.json());
        }
      } catch (e) {
        console.error('Failed to fetch user settings:', e);
      }
    };
    fetchUserSettings();
  }, []);

  // themeId変更時の処理
  useEffect(() => {
    console.log('[TaskSuggestions] Theme changed to:', themeId);

    if (!themeId) {
      setAiSuggestions([]);
      setAiAnalysis(null);
      setIsCached(false);
      setIsExpanded(false);
      setIsCacheLoading(false);
      return;
    }

    const loadCacheAndMaybeAutoFetch = async () => {
      console.log('[TaskSuggestions] Starting cache load for theme:', themeId);
      setIsCacheLoading(true);
      let cacheFound = false;

      try {
        const res = await fetch(
          `${API_BASE_URL}/tasks/suggestions/ai/cache?themeId=${themeId}`,
        );
        if (res.ok) {
          const data: AiSuggestionsResponse = await res.json();
          console.log('[TaskSuggestions] Cache response:', data.source, 'suggestions:', data.suggestions.length);

          if (data.source === 'cache' && data.suggestions.length > 0) {
            setAiSuggestions(data.suggestions);
            setAiAnalysis(data.analysis);
            setIsCached(true);
            setIsExpanded(true);
            cacheFound = true;
          }
        }
      } catch (e) {
        console.error('[TaskSuggestions] Cache load error:', e);
      }

      setIsCacheLoading(false);

      // 自動取得のロジック改善
      const shouldAutoFetch = userSettings?.autoFetchTaskSuggestions && !cacheFound;
      const alreadyFetched = hasAutoFetchedForTheme.has(themeId);

      console.log('[TaskSuggestions] Auto-fetch check:', {
        autoFetchEnabled: userSettings?.autoFetchTaskSuggestions,
        cacheFound,
        shouldAutoFetch,
        alreadyFetched,
        themeId
      });

      if (shouldAutoFetch && !alreadyFetched) {
        console.log('[TaskSuggestions] Starting auto-fetch for theme:', themeId);

        // このテーマに対して自動取得済みとマーク
        setHasAutoFetchedForTheme(prev => new Set(prev).add(themeId));

        // AI提案を自動取得
        setIsAiLoading(true);
        setAiError(false);
        try {
          const res = await fetch(
            `${API_BASE_URL}/tasks/suggestions/ai?themeId=${themeId}&limit=5`,
          );
          if (res.ok) {
            const data: AiSuggestionsResponse = await res.json();
            console.log('[TaskSuggestions] AI response:', data.source, 'suggestions:', data.suggestions.length);

            if (data.source === 'ai' && data.suggestions.length > 0) {
              setAiSuggestions(data.suggestions);
              setAiAnalysis(data.analysis);
              setIsCached(false);
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
      } else if (!cacheFound) {
        // キャッシュが無い場合はリセット
        console.log('[TaskSuggestions] No cache found, resetting state');
        setAiSuggestions([]);
        setAiAnalysis(null);
        setIsCached(false);
        setIsExpanded(false);
      }
    };

    loadCacheAndMaybeAutoFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId, userSettings?.autoFetchTaskSuggestions]);

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

            // 強制リフレッシュの場合は、自動取得フラグをリセット（次回テーマ選択時に再度自動取得可能にする）
            if (forceRefresh) {
              console.log('[TaskSuggestions] Resetting auto-fetch flag for theme:', themeId);
              setHasAutoFetchedForTheme(prev => {
                const newSet = new Set(prev);
                newSet.delete(themeId);
                return newSet;
              });
            }
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

    // キャッシュクリア時も自動取得フラグをリセット（次回テーマ選択時に再度自動取得可能にする）
    console.log('[TaskSuggestions] Resetting auto-fetch flag for theme:', themeId);
    setHasAutoFetchedForTheme(prev => {
      const newSet = new Set(prev);
      newSet.delete(themeId);
      return newSet;
    });
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
          <div className="flex flex-col gap-2">
            {visibleSuggestions.map((suggestion, idx) => (
              <div
                key={`${suggestion.title}-${idx}`}
                className="group relative rounded-lg border bg-white dark:bg-zinc-800/50 border-violet-200/50 dark:border-violet-800/30 hover:border-violet-300 dark:hover:border-violet-700 transition-all overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => handleSuggestionClick(suggestion)}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  className="w-full text-left px-3 py-2.5 hover:bg-violet-50/50 dark:hover:bg-violet-900/10 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
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

                        {/* Priority and time */}
                        {(suggestion.priority === 'urgent' || suggestion.priority === 'high') && (
                          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-rose-500 dark:bg-rose-400" />
                        )}

                        {suggestion.estimatedHours && (
                          <div className="flex items-center gap-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                            <Clock className="w-3 h-3" />
                            <span>{suggestion.estimatedHours}h</span>
                          </div>
                        )}
                      </div>

                      {/* Title */}
                      <h4 className="font-medium text-sm text-zinc-800 dark:text-zinc-200 mb-0.5">
                        {suggestion.title}
                      </h4>

                      {/* SMART indicators */}
                      <div className="flex items-center gap-3 mt-1.5">
                        {suggestion.measurableOutcome && (
                          <div className="flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-400">
                            <BarChart3 className="w-3 h-3" />
                            <span>測定可能</span>
                          </div>
                        )}
                        {suggestion.completionCriteria && (
                          <div className="flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>明確な完了条件</span>
                          </div>
                        )}
                        {suggestion.dependencies && (
                          <div className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                            <Target className="w-3 h-3" />
                            <span>前提条件あり</span>
                          </div>
                        )}
                      </div>

                      {/* Brief description on hover */}
                      {suggestion.description && (
                        <p
                          className={`mt-1.5 text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed line-clamp-2 transition-all ${
                            hoveredIndex === idx
                              ? 'opacity-100'
                              : 'opacity-0'
                          }`}
                        >
                          {suggestion.description}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 p-1">
                      <Info className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
                    </div>
                  </div>
                </button>

                {/* Quick apply button */}
                <div className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleApply(suggestion);
                    }}
                    className="px-2 py-1 text-[10px] font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors"
                  >
                    すぐに作成
                  </button>
                </div>
              </div>
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
            AI提案の生成に失敗しました。APIキーの設定を確認してください。
          </p>
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
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
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
