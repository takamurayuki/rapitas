import React from 'react';
import { Search, FileText, Code, CheckCircle } from 'lucide-react';

interface WorkflowProgressBarProps {
  currentPhase: 'research' | 'plan' | 'implement' | 'verify' | null;
  className?: string;
}

const WORKFLOW_STEPS = [
  {
    key: 'research',
    label: '調査',
    icon: Search,
    description: 'コードを調査中',
  },
  {
    key: 'plan',
    label: '計画',
    icon: FileText,
    description: '実装計画を作成中',
  },
  {
    key: 'implement',
    label: '実装',
    icon: Code,
    description: 'コードを実装中',
  },
  {
    key: 'verify',
    label: '検証',
    icon: CheckCircle,
    description: '実装結果を検証中',
  },
] as const;

/**
 * ワークフロー進捗バーコンポーネント
 * 4段階のワークフローの進行状況を視覚的に表示
 */
export const WorkflowProgressBar: React.FC<WorkflowProgressBarProps> = ({
  currentPhase,
  className = '',
}) => {
  const getCurrentStepIndex = () => {
    if (!currentPhase) return -1;
    return WORKFLOW_STEPS.findIndex((step) => step.key === currentPhase);
  };

  const currentStepIndex = getCurrentStepIndex();

  return (
    <div
      className={`px-4 py-3 bg-zinc-800/30 border-b border-zinc-700 ${className}`}
    >
      <div className="flex items-center justify-between max-w-2xl mx-auto">
        {WORKFLOW_STEPS.map((step, index) => {
          const IconComponent = step.icon;
          const isActive = index === currentStepIndex;
          const isCompleted = index < currentStepIndex;
          const _isPending = index > currentStepIndex;

          // ステップの状態に基づくスタイリング
          const getStepStyles = () => {
            if (isActive) {
              return {
                bg: 'bg-blue-500/20',
                border: 'border-blue-500',
                text: 'text-blue-300',
                icon: 'text-blue-400',
              };
            }
            if (isCompleted) {
              return {
                bg: 'bg-green-500/20',
                border: 'border-green-500',
                text: 'text-green-300',
                icon: 'text-green-400',
              };
            }
            return {
              bg: 'bg-zinc-700/30',
              border: 'border-zinc-600',
              text: 'text-zinc-500',
              icon: 'text-zinc-600',
            };
          };

          const styles = getStepStyles();

          return (
            <React.Fragment key={step.key}>
              {/* ステップアイテム */}
              <div className="flex flex-col items-center gap-2 relative">
                <div
                  className={`
                    w-10 h-10 rounded-full border-2 flex items-center justify-center
                    transition-all duration-300
                    ${styles.bg} ${styles.border}
                    ${isActive ? 'animate-pulse' : ''}
                  `}
                  title={isActive ? step.description : step.label}
                >
                  <IconComponent className={`w-4 h-4 ${styles.icon}`} />
                </div>

                <div className="text-center">
                  <div className={`text-xs font-medium ${styles.text}`}>
                    {step.label}
                  </div>
                  {isActive && (
                    <div className="text-xs text-zinc-400 mt-0.5 whitespace-nowrap">
                      {step.description}
                    </div>
                  )}
                </div>

                {/* アクティブステップのプログレスインジケーター */}
                {isActive && (
                  <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2">
                    <div className="w-2 h-1 bg-blue-400 rounded-full animate-pulse" />
                  </div>
                )}
              </div>

              {/* 接続線 */}
              {index < WORKFLOW_STEPS.length - 1 && (
                <div className="flex-1 h-0.5 mx-4 relative">
                  <div className="absolute inset-0 bg-zinc-700 rounded-full" />
                  {isCompleted && (
                    <div className="absolute inset-0 bg-green-500 rounded-full" />
                  )}
                  {isActive && (
                    <div className="absolute inset-0 bg-gradient-to-r from-green-500 to-blue-500 rounded-full opacity-60" />
                  )}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* 全体の進行状況 */}
      {currentPhase && (
        <div className="mt-3 text-center">
          <div className="text-xs text-zinc-400">
            全体進捗: {currentStepIndex + 1}/{WORKFLOW_STEPS.length}{' '}
            ステップ完了
          </div>
          <div className="mt-1 w-full bg-zinc-700 rounded-full h-1 max-w-xs mx-auto">
            <div
              className="bg-gradient-to-r from-green-500 to-blue-500 h-1 rounded-full transition-all duration-500"
              style={{
                width: `${((currentStepIndex + 1) / WORKFLOW_STEPS.length) * 100}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowProgressBar;
