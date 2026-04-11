/**
 * TaskSuggestions
 *
 * Manages AI-powered task suggestion state and coordinates between the header,
 * suggestion cards, and detail modal sub-components. Handles cache lookup,
 * generation, and deletion without owning any visual logic.
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { Info } from 'lucide-react';
import type { Priority } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { SuggestionsHeader } from './task-suggestions/SuggestionsHeader';
import {
  SuggestionCard,
  type TaskSuggestion,
} from './task-suggestions/SuggestionCard';
import { SuggestionDetailModal } from './task-suggestions/SuggestionDetailModal';

const logger = createLogger('TaskSuggestions');

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

/**
 * Container component for AI task suggestions.
 *
 * @param props - See TaskSuggestionsProps
 * @returns Collapsible panel with suggestion list and detail modal.
 */
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
  const [selectedSuggestion, setSelectedSuggestion] =
    useState<TaskSuggestion | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [deletedIndices, setDeletedIndices] = useState<Set<number>>(new Set());

  // Reset suggestions when the theme changes
  useEffect(() => {
    logger.debug('[TaskSuggestions] Theme changed to:', themeId);
    if (!themeId) {
      setAiSuggestions([]);
      setAiAnalysis(null);
      setIsCached(false);
      setIsExpanded(false);
      setDeletedIndices(new Set());
      setAiError(false);
    }
  }, [themeId]);

  const fetchAiSuggestions = useCallback(
    async (forceRefresh = false) => {
      if (!themeId) return;

      logger.debug(
        '[TaskSuggestions] Fetching AI suggestions, forceRefresh:',
        forceRefresh,
      );
      setIsAiLoading(true);
      setAiError(false);

      // NOTE: Cache is checked first to avoid unnecessary AI calls.
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
              logger.debug('[TaskSuggestions] Using cached suggestions');
              setAiSuggestions(cacheData.suggestions);
              setAiAnalysis(cacheData.analysis);
              setIsCached(true);
              setIsAiLoading(false);
              setIsExpanded(true);
              return;
            }
          }
        } catch (e) {
          // Fall back to AI generation when cache fetch fails
          logger.error('[TaskSuggestions] Cache fetch error:', e);
        }
      }

      try {
        logger.debug('[TaskSuggestions] Generating new AI suggestions');
        const res = await fetch(
          `${API_BASE_URL}/tasks/suggestions/ai?themeId=${themeId}&limit=5`,
        );
        if (res.ok) {
          const data: AiSuggestionsResponse = await res.json();
          logger.debug(
            '[TaskSuggestions] AI generation response:',
            data.source,
            'suggestions:',
            data.suggestions.length,
          );

          if (data.source === 'ai' && data.suggestions.length > 0) {
            setAiSuggestions(data.suggestions);
            setAiAnalysis(data.analysis);
            setIsCached(false);
            setIsExpanded(true);
          } else {
            setAiSuggestions([]);
            setAiAnalysis(null);
            if (
              data.source === 'ai_error' ||
              data.source === 'insufficient_data'
            ) {
              logger.debug(
                '[TaskSuggestions] AI generation failed:',
                data.source,
              );
              setAiError(true);
            }
          }
        }
      } catch (e) {
        logger.error('[TaskSuggestions] Failed to fetch AI suggestions:', e);
        setAiError(true);
      } finally {
        setIsAiLoading(false);
      }
    },
    [themeId],
  );

  const clearCache = useCallback(async () => {
    if (!themeId) return;
    logger.debug('[TaskSuggestions] Clearing cache for theme:', themeId);
    try {
      await fetch(
        `${API_BASE_URL}/tasks/suggestions/ai/cache?themeId=${themeId}`,
        {
          method: 'DELETE',
        },
      );
    } catch (e) {
      logger.error('[TaskSuggestions] Failed to clear cache:', e);
    }
    setAiSuggestions([]);
    setAiAnalysis(null);
    setIsCached(false);
    setIsExpanded(false);
  }, [themeId]);

  const handleApply = (suggestion: TaskSuggestion) => {
    let enhancedDescription = suggestion.description ?? '';
    if (suggestion.completionCriteria) {
      enhancedDescription +=
        '\n\n【完了条件】\n' + suggestion.completionCriteria;
    }
    if (suggestion.measurableOutcome) {
      enhancedDescription +=
        '\n\n【測定可能な成果】\n' + suggestion.measurableOutcome;
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

  const filteredSuggestions = aiSuggestions.filter(
    (_, idx) => !deletedIndices.has(idx),
  );
  const visibleSuggestions = isListExpanded
    ? filteredSuggestions
    : filteredSuggestions.slice(0, 3);

  const hasSuggestions = filteredSuggestions.length > 0;
  const canExpand = hasSuggestions;

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800/50">
      <SuggestionsHeader
        hasSuggestions={hasSuggestions}
        suggestionCount={filteredSuggestions.length}
        isAiLoading={isAiLoading}
        isExpanded={isExpanded}
        canExpand={canExpand}
        onHeaderClick={() => {
          if (canExpand) setIsExpanded(!isExpanded);
        }}
        onGenerate={() => {
          setDeletedIndices(new Set());
          fetchAiSuggestions(false);
        }}
        onRefresh={() => {
          setDeletedIndices(new Set());
          fetchAiSuggestions(true);
        }}
        onClear={() => {
          clearCache();
          setDeletedIndices(new Set());
        }}
      />

      {/* Suggestion list — animated expand/collapse */}
      <div
        className={`overflow-hidden transition-all duration-300 ${
          isExpanded && hasSuggestions
            ? 'max-h-[600px] opacity-100'
            : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-3 pb-2 pt-1">
          {aiAnalysis && (
            <div className="mb-2 px-2 py-0.5 rounded bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-900/10 dark:to-indigo-900/10">
              <p className="text-[10px] text-zinc-600 dark:text-zinc-400 leading-snug text-center italic">
                {aiAnalysis}
              </p>
            </div>
          )}

          <div className="space-y-1">
            {visibleSuggestions.map((suggestion) => {
              const realIdx = aiSuggestions.findIndex((s) => s === suggestion);
              return (
                <SuggestionCard
                  key={`${suggestion.title}-${realIdx}`}
                  suggestion={suggestion}
                  onApply={() => handleApply(suggestion)}
                  onDismiss={() =>
                    setDeletedIndices((prev) => new Set(prev).add(realIdx))
                  }
                  onClick={() => {
                    setSelectedSuggestion(suggestion);
                    setShowDetail(true);
                  }}
                />
              );
            })}
          </div>

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

          {isCached && (
            <div className="mt-1 text-center">
              <span className="text-[8px] text-zinc-400 dark:text-zinc-500">
                キャッシュ済み
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Error state */}
      {aiError && !isAiLoading && aiSuggestions.length === 0 && (
        <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800/50">
          <div className="flex items-center justify-center gap-1.5 text-zinc-500 dark:text-zinc-400">
            <Info className="w-3 h-3" />
            <p className="text-[10px]">AI提案の生成に失敗しました</p>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {showDetail && selectedSuggestion && (
        <SuggestionDetailModal
          suggestion={selectedSuggestion}
          onClose={() => {
            setShowDetail(false);
            setSelectedSuggestion(null);
          }}
          onApply={() => handleApply(selectedSuggestion)}
        />
      )}
    </div>
  );
}
