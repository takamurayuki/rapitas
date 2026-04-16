'use client';
// AnalysisSection

import {
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  ListTodo,
  FileText,
} from 'lucide-react';
import { SkeletonBlock } from '@/components/ui/LoadingSpinner';
import type { TaskAnalysisResult } from '@/types';
import type { AnalysisTabType, PromptResult } from './types';
import { SubtaskPanel } from './SubtaskPanel';
import { PromptPanel } from './PromptPanel';

export type AnalysisSectionProps = {
  isExpanded: boolean;
  onToggle: () => void;
  analysisStatusIcon: 'loading' | 'success' | 'error' | 'idle';
  // Tab
  analysisTab: AnalysisTabType;
  onTabChange: (tab: AnalysisTabType) => void;
  // Subtask tab
  isAnalyzing: boolean;
  analysisError: string | null;
  analysisResult: TaskAnalysisResult | null;
  analysisApprovalId: number | null;
  selectedSubtasks: number[];
  onSelectSubtask: (index: number) => void;
  onSelectAll: () => void;
  isCreatingSubtasks: boolean;
  subtaskCreationSuccess: boolean;
  onApproveSubtasks: () => Promise<void>;
  onAnalyze: () => Promise<void>;
  // Prompt tab
  isGeneratingPrompt: boolean;
  promptResult: PromptResult | null;
  promptError: string | null;
  questionAnswers: Record<string, string>;
  isSubmittingAnswers: boolean;
  copied: boolean;
  onSetQuestionAnswer: (id: string, value: string) => void;
  onCancelQuestions: () => void;
  onSubmitAnswers: () => Promise<void>;
  onCopyPrompt: () => void;
  onUsePrompt: () => void;
  onRegeneratePrompt: () => void;
  onGeneratePrompt: () => void;
  onRetryPrompt: () => void;
  getCategoryLabel: (category: string) => string;
};

/**
 * Collapsible analysis + prompt-optimization accordion section.
 *
 * @param props - All display data and event handlers from the parent panel.
 */
export function AnalysisSection({
  isExpanded,
  onToggle,
  analysisStatusIcon,
  analysisTab,
  onTabChange,
  isAnalyzing,
  analysisError,
  analysisResult,
  analysisApprovalId,
  selectedSubtasks,
  onSelectSubtask,
  onSelectAll,
  isCreatingSubtasks,
  subtaskCreationSuccess,
  onApproveSubtasks,
  onAnalyze,
  isGeneratingPrompt,
  promptResult,
  promptError,
  questionAnswers,
  isSubmittingAnswers,
  copied,
  onSetQuestionAnswer,
  onCancelQuestions,
  onSubmitAnswers,
  onCopyPrompt,
  onUsePrompt,
  onRegeneratePrompt,
  onGeneratePrompt,
  onRetryPrompt,
  getCategoryLabel,
}: AnalysisSectionProps) {
  return (
    <div className="border-b border-zinc-100 dark:border-zinc-800">
      {/* Section header (accordion trigger) */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
        aria-expanded={isExpanded}
        aria-controls="analysis-section-content"
      >
        <div className="flex items-center gap-2">
          <BrainCircuit className="w-4 h-4 text-violet-500" />
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            タスク分析
          </span>
          {analysisStatusIcon === 'loading' && (
            <SkeletonBlock className="w-3 h-3 rounded" />
          )}
          {analysisStatusIcon === 'success' && (
            <CheckCircle2 className="w-3 h-3 text-green-500" />
          )}
          {analysisStatusIcon === 'error' && (
            <AlertCircle className="w-3 h-3 text-red-500" />
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-zinc-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-zinc-400" />
        )}
      </button>

      {isExpanded && (
        <div id="analysis-section-content" className="px-4 pb-3 space-y-3">
          {/* Tab bar */}
          <div
            className="flex border-b border-zinc-200 dark:border-zinc-700"
            role="tablist"
          >
            <button
              role="tab"
              aria-selected={analysisTab === 'subtasks'}
              aria-controls="subtasks-panel"
              onClick={() => onTabChange('subtasks')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium transition-colors ${
                analysisTab === 'subtasks'
                  ? 'text-violet-600 dark:text-violet-400 border-b-2 border-violet-600 dark:border-violet-400 bg-violet-50/50 dark:bg-violet-900/10'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              <ListTodo className="w-3.5 h-3.5" />
              サブタスク
              {analysisResult?.suggestedSubtasks?.length ? (
                <span className="px-1 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded text-[10px]">
                  {analysisResult.suggestedSubtasks.length}
                </span>
              ) : null}
            </button>
            <button
              role="tab"
              aria-selected={analysisTab === 'prompt'}
              aria-controls="prompt-panel"
              onClick={() => onTabChange('prompt')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium transition-colors ${
                analysisTab === 'prompt'
                  ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400 bg-indigo-50/50 dark:bg-indigo-900/10'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              プロンプト
              {promptResult && (
                <span className="px-1 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded text-[10px]">
                  ✓
                </span>
              )}
            </button>
          </div>

          {analysisTab === 'subtasks' && (
            <SubtaskPanel
              isAnalyzing={isAnalyzing}
              analysisError={analysisError}
              analysisResult={analysisResult}
              analysisApprovalId={analysisApprovalId}
              selectedSubtasks={selectedSubtasks}
              onSelectSubtask={onSelectSubtask}
              onSelectAll={onSelectAll}
              isCreatingSubtasks={isCreatingSubtasks}
              subtaskCreationSuccess={subtaskCreationSuccess}
              onApproveSubtasks={onApproveSubtasks}
              onAnalyze={onAnalyze}
            />
          )}

          {analysisTab === 'prompt' && (
            <PromptPanel
              isGeneratingPrompt={isGeneratingPrompt}
              promptResult={promptResult}
              promptError={promptError}
              questionAnswers={questionAnswers}
              isSubmittingAnswers={isSubmittingAnswers}
              copied={copied}
              onSetQuestionAnswer={onSetQuestionAnswer}
              onCancelQuestions={onCancelQuestions}
              onSubmitAnswers={onSubmitAnswers}
              onCopyPrompt={onCopyPrompt}
              onUsePrompt={onUsePrompt}
              onRegeneratePrompt={onRegeneratePrompt}
              onGeneratePrompt={onGeneratePrompt}
              onRetryPrompt={onRetryPrompt}
              getCategoryLabel={getCategoryLabel}
            />
          )}
        </div>
      )}
    </div>
  );
}
