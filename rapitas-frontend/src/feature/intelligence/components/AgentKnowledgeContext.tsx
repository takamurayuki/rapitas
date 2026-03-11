'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Share2,
  AlertTriangle,
  CheckCircle2,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('AgentKnowledgeContext');

type SharedKnowledge = {
  patterns: Array<{
    id: number;
    description: string;
    category: string;
    confidence: number;
    occurrences: number;
    actions: unknown[];
  }>;
  relevantKnowledge: Array<{
    id: number;
    title: string;
    content: string;
    category: string;
    confidence: number;
  }>;
  warnings: Array<{
    id: number;
    description: string;
    occurrences: number;
  }>;
  promptEvolutions: Array<{
    id: number;
    changeDescription: string;
    performanceScore: number | null;
  }>;
};

interface AgentKnowledgeContextProps {
  taskId: number;
}

const categoryColors: Record<string, string> = {
  success_strategy:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  failure_pattern:
    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  optimization:
    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  anti_pattern:
    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  procedure: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  pattern:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  insight:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  fact: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

const categoryLabels: Record<string, string> = {
  success_strategy: '成功パターン',
  failure_pattern: '失敗パターン',
  optimization: '最適化',
  anti_pattern: 'アンチパターン',
  procedure: '手順',
  pattern: 'パターン',
  insight: '知見',
  fact: '事実',
};

export function AgentKnowledgeContext({ taskId }: AgentKnowledgeContextProps) {
  const [knowledge, setKnowledge] = useState<SharedKnowledge | null>(null);
  const [hasData, setHasData] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const fetchContext = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/intelligence/tasks/${taskId}/agent-context`,
      );
      if (res.ok) {
        const data = await res.json();
        setKnowledge(data.knowledge || null);
        setHasData(data.hasRelevantData || false);
      }
    } catch (e) {
      logger.warn('Failed to fetch agent knowledge context:', e);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchContext();
  }, [fetchContext]);

  if (loading) {
    return (
      <div className="px-4 py-2 bg-indigo-50/50 dark:bg-indigo-900/10 border-t border-indigo-100 dark:border-indigo-900/30">
        <div className="flex items-center gap-2 text-xs text-indigo-500">
          <div className="w-3 h-3 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin" />
          共有ナレッジを取得中...
        </div>
      </div>
    );
  }

  if (!hasData || !knowledge) return null;

  const totalItems =
    knowledge.patterns.length +
    knowledge.relevantKnowledge.length +
    knowledge.warnings.length;

  return (
    <div className="border-t border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/30 dark:bg-indigo-900/10">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-4 py-2.5 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Share2 className="w-4 h-4 text-indigo-500" />
          <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
            エージェント共有ナレッジ
          </span>
          <span className="px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded text-[10px] font-medium">
            {totalItems}件
          </span>
          {knowledge.warnings.length > 0 && (
            <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-[10px] font-medium">
              {knowledge.warnings.length}件の警告
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-indigo-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-indigo-400" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          {/* Warnings */}
          {knowledge.warnings.length > 0 && (
            <div>
              <h4 className="text-[10px] font-medium text-red-600 dark:text-red-400 mb-1.5 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                過去の失敗パターン
              </h4>
              {knowledge.warnings.map((w) => (
                <div
                  key={w.id}
                  className="p-2 rounded-md bg-red-50 dark:bg-red-900/15 border border-red-100 dark:border-red-900/30 mb-1"
                >
                  <p className="text-xs text-red-700 dark:text-red-300">
                    {w.description}
                  </p>
                  <span className="text-[10px] text-red-500 dark:text-red-400">
                    {w.occurrences}回発生
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Success patterns */}
          {knowledge.patterns.length > 0 && (
            <div>
              <h4 className="text-[10px] font-medium text-green-600 dark:text-green-400 mb-1.5 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                学習パターン
              </h4>
              <div className="space-y-1">
                {knowledge.patterns.slice(0, 5).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-start gap-2 p-2 rounded-md bg-white/60 dark:bg-zinc-800/40"
                  >
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${categoryColors[p.category] || 'bg-gray-100 text-gray-600'}`}
                    >
                      {categoryLabels[p.category] || p.category}
                    </span>
                    <p className="text-xs text-zinc-700 dark:text-zinc-300 flex-1 line-clamp-2">
                      {p.description}
                    </p>
                    <span className="text-[10px] text-zinc-400 shrink-0">
                      {Math.round(p.confidence * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Relevant knowledge */}
          {knowledge.relevantKnowledge.length > 0 && (
            <div>
              <h4 className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400 mb-1.5 flex items-center gap-1">
                <BookOpen className="w-3 h-3" />
                関連ナレッジ
              </h4>
              <div className="space-y-1">
                {knowledge.relevantKnowledge.slice(0, 3).map((k) => (
                  <div
                    key={k.id}
                    className="p-2 rounded-md bg-white/60 dark:bg-zinc-800/40"
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">
                        {k.title}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${categoryColors[k.category] || 'bg-gray-100 text-gray-600'}`}
                      >
                        {categoryLabels[k.category] || k.category}
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 line-clamp-2">
                      {k.content}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prompt evolutions */}
          {knowledge.promptEvolutions.length > 0 && (
            <div>
              <h4 className="text-[10px] font-medium text-violet-600 dark:text-violet-400 mb-1.5 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                プロンプト改善履歴
              </h4>
              {knowledge.promptEvolutions.slice(0, 3).map((pe) => (
                <div
                  key={pe.id}
                  className="flex items-center gap-2 p-1.5 text-xs text-zinc-600 dark:text-zinc-400"
                >
                  <span className="flex-1 truncate">
                    {pe.changeDescription}
                  </span>
                  {pe.performanceScore !== null && (
                    <span className="text-[10px] text-violet-500 shrink-0">
                      スコア: {pe.performanceScore}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
