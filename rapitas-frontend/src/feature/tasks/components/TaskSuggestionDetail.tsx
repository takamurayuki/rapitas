'use client';
import { useState } from 'react';
import {
  CheckCircle,
  Target,
  AlertCircle,
  Route,
  ChevronRight,
  ChevronDown,
  Clock,
  BarChart3,
  ListChecks,
} from 'lucide-react';

type TaskSuggestionDetailProps = {
  suggestion: {
    title: string;
    description: string | null;
    priority: string;
    estimatedHours: number | null;
    reason?: string | null;
    category?: 'recurring' | 'extension' | 'improvement' | 'new';
    completionCriteria?: string | null;
    measurableOutcome?: string | null;
    dependencies?: string | null;
    suggestedApproach?: string | null;
  };
  onApply: () => void;
};

export default function TaskSuggestionDetail({
  suggestion,
  onApply,
}: TaskSuggestionDetailProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['criteria', 'outcome']),
  );

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-900/30';
      case 'high':
        return 'text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30';
      case 'medium':
        return 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30';
      case 'low':
        return 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30';
      default:
        return 'text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/30';
    }
  };

  const formatCriteria = (criteria: string) => {
    return criteria
      .split(/[・\n]/)
      .filter((item) => item.trim())
      .map((item) => item.trim());
  };

  return (
    <div className="space-y-4">
      {/* Header with title and basic info */}
      <div>
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
          {suggestion.title}
        </h3>
        <div className="flex items-center gap-3 text-sm">
          <span
            className={`px-2 py-1 rounded-md text-xs font-medium ${getPriorityColor(suggestion.priority)}`}
          >
            {suggestion.priority === 'urgent'
              ? '緊急'
              : suggestion.priority === 'high'
                ? '高'
                : suggestion.priority === 'medium'
                  ? '中'
                  : '低'}
            優先度
          </span>
          {suggestion.estimatedHours && (
            <div className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
              <Clock className="w-4 h-4" />
              <span>{suggestion.estimatedHours}時間</span>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {suggestion.description && (
        <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
          {suggestion.description}
        </p>
      )}

      {/* SMART Goal Indicators */}
      <div className="grid grid-cols-2 gap-3">
        {/* Measurable Outcome */}
        {suggestion.measurableOutcome && (
          <div className="p-3 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/50">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              <span className="text-xs font-medium text-violet-700 dark:text-violet-300">
                測定可能な成果
              </span>
            </div>
            <p className="text-xs text-violet-600 dark:text-violet-300">
              {suggestion.measurableOutcome}
            </p>
          </div>
        )}

        {/* Time-bound */}
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
              推定所要時間
            </span>
          </div>
          <p className="text-xs text-blue-600 dark:text-blue-300">
            {suggestion.estimatedHours
              ? `${suggestion.estimatedHours}時間`
              : '未設定'}
          </p>
        </div>
      </div>

      {/* Expandable sections */}
      <div className="space-y-2">
        {/* Completion Criteria */}
        {suggestion.completionCriteria && (
          <div className="border rounded-lg dark:border-zinc-700">
            <button
              onClick={() => toggleSection('criteria')}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span className="text-sm font-medium">完了条件</span>
              </div>
              {expandedSections.has('criteria') ? (
                <ChevronDown className="w-4 h-4 text-zinc-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-zinc-400" />
              )}
            </button>
            {expandedSections.has('criteria') && (
              <div className="px-4 pb-3 pt-1">
                <ul className="space-y-1">
                  {formatCriteria(suggestion.completionCriteria).map(
                    (item, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-300"
                      >
                        <ListChecks className="w-3 h-3 mt-0.5 text-green-500 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Dependencies */}
        {suggestion.dependencies && (
          <div className="border rounded-lg dark:border-zinc-700">
            <button
              onClick={() => toggleSection('dependencies')}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-medium">前提条件</span>
              </div>
              {expandedSections.has('dependencies') ? (
                <ChevronDown className="w-4 h-4 text-zinc-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-zinc-400" />
              )}
            </button>
            {expandedSections.has('dependencies') && (
              <div className="px-4 pb-3 pt-1">
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  {suggestion.dependencies}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Suggested Approach */}
        {suggestion.suggestedApproach && (
          <div className="border rounded-lg dark:border-zinc-700">
            <button
              onClick={() => toggleSection('approach')}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Route className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span className="text-sm font-medium">推奨アプローチ</span>
              </div>
              {expandedSections.has('approach') ? (
                <ChevronDown className="w-4 h-4 text-zinc-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-zinc-400" />
              )}
            </button>
            {expandedSections.has('approach') && (
              <div className="px-4 pb-3 pt-1">
                <p className="text-sm text-zinc-600 dark:text-zinc-300 whitespace-pre-line">
                  {suggestion.suggestedApproach}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Reason */}
        {suggestion.reason && (
          <div className="border rounded-lg dark:border-zinc-700">
            <button
              onClick={() => toggleSection('reason')}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <span className="text-sm font-medium">提案理由</span>
              </div>
              {expandedSections.has('reason') ? (
                <ChevronDown className="w-4 h-4 text-zinc-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-zinc-400" />
              )}
            </button>
            {expandedSections.has('reason') && (
              <div className="px-4 pb-3 pt-1">
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  {suggestion.reason}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Apply button */}
      <button
        type="button"
        onClick={onApply}
        className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm transition-colors"
      >
        このタスクを作成
      </button>
    </div>
  );
}
