'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, Zap, ArrowRight, Settings, Info, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
const logger = createLogger('WorkflowModeSelector');

export type WorkflowMode = 'lightweight' | 'standard' | 'comprehensive';

export interface WorkflowModeConfig {
  mode: WorkflowMode;
  name: string;
  description: string;
  estimatedTime: string;
  steps: string[];
  icon: typeof Zap;
  color: string;
  bgColor: string;
}

/**
 * Builds the mode selector's display config. A function (not a module
 * constant) because the names/descriptions/steps are translated.
 *
 * @param t - Translator scoped to the `workflow` namespace / workflow名前空間のt
 * @returns Mode → display config map / モードごとの表示設定
 */
function getWorkflowModeConfigs(
  t: ReturnType<typeof useTranslations<'workflow'>>,
): Record<WorkflowMode, WorkflowModeConfig> {
  return {
    lightweight: {
      mode: 'lightweight',
      name: t('modeSelector.lightweightName'),
      description: t('modeLightweightDesc'),
      estimatedTime: t('modeSelector.lightweightTime'),
      steps: [t('stepImplement'), t('stepVerify')],
      icon: Zap,
      color: 'text-green-600 dark:text-green-400',
      bgColor: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50',
    },
    standard: {
      mode: 'standard',
      name: t('modeSelector.standardName'),
      description: t('modeStandardDesc'),
      estimatedTime: t('modeSelector.standardTime'),
      steps: [t('stepPlan'), t('stepImplement'), t('stepVerifyFull')],
      icon: ArrowRight,
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50',
    },
    comprehensive: {
      mode: 'comprehensive',
      name: t('modeSelector.comprehensiveName'),
      description: t('modeComprehensiveDesc'),
      estimatedTime: t('modeSelector.comprehensiveTime'),
      steps: [t('stepResearch'), t('stepPlan'), t('stepImplement'), t('stepVerifyFull')],
      icon: Settings,
      color: 'text-purple-600 dark:text-purple-400',
      bgColor: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800/50',
    },
  };
}

export interface WorkflowModeSelectorProps {
  taskId: number;
  currentMode?: WorkflowMode | null;
  isOverridden?: boolean;
  onModeChange?: (mode: WorkflowMode, isOverride: boolean) => void;
  disabled?: boolean;
  showAnalyzeButton?: boolean;
  className?: string;
}

export default function WorkflowModeSelector({
  taskId,
  currentMode = 'comprehensive',
  isOverridden = false,
  onModeChange,
  disabled = false,
  showAnalyzeButton = true,
  className = '',
}: WorkflowModeSelectorProps) {
  const t = useTranslations('workflow');
  const tc = useTranslations('common');
  const WORKFLOW_MODE_CONFIGS = getWorkflowModeConfigs(t);
  const [selectedMode, setSelectedMode] = useState<WorkflowMode>(currentMode || 'comprehensive');
  const [isOpen, setIsOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (currentMode) {
      setSelectedMode(currentMode);
    }
  }, [currentMode]);

  const handleModeSelect = async (mode: WorkflowMode) => {
    if (mode === selectedMode || disabled) return;

    setIsUpdating(true);
    try {
      const response = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/set-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, override: true }),
      });

      const data = await response.json();
      if (data.success) {
        setSelectedMode(mode);
        onModeChange?.(mode, true);
      } else {
        logger.error('Failed to set workflow mode:', data.error);
      }
    } catch (err) {
      logger.error('Error setting workflow mode:', err);
    } finally {
      setIsUpdating(false);
      setIsOpen(false);
    }
  };

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      const response = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/analyze-complexity`);
      const data = await response.json();

      if (data.success && data.analysis.recommendedMode) {
        const recommendedMode = data.analysis.recommendedMode as WorkflowMode;
        setSelectedMode(recommendedMode);
        onModeChange?.(recommendedMode, false);
      } else {
        logger.error('Failed to analyze complexity:', data.error);
      }
    } catch (err) {
      logger.error('Error analyzing complexity:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const currentConfig = WORKFLOW_MODE_CONFIGS[selectedMode];
  const CurrentIcon = currentConfig.icon;

  return (
    <div className={`relative ${className}`}>
      {/* Main selector */}
      <div className="space-y-3">
        {/* Current mode display */}
        <div className={`p-4 rounded-lg border ${currentConfig.bgColor}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full bg-white dark:bg-zinc-800 ${currentConfig.color}`}>
                <CurrentIcon className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className={`text-sm font-medium ${currentConfig.color}`}>
                    {currentConfig.name}
                  </h3>
                  {isOverridden && (
                    <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300 text-xs font-medium rounded-full">
                      {t('modeSelector.manualSetting')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                  {currentConfig.description}
                </p>
                <div className="flex items-center gap-4 mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>
                    {t('modeSelector.executionTimeLabel')} {currentConfig.estimatedTime}
                  </span>
                  <span>
                    {t('modeSelector.stepsLabel')} {currentConfig.steps.join(' → ')}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Analyze button */}
              {showAnalyzeButton && (
                <button
                  onClick={handleAnalyze}
                  disabled={disabled || isAnalyzing || isUpdating}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={t('modeSelector.autoAnalyzeHint')}
                >
                  {isAnalyzing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Info className="h-3 w-3" />
                  )}
                  {t('autoAnalyze')}
                </button>
              )}

              {/* Mode change button */}
              <button
                onClick={() => setIsOpen(!isOpen)}
                disabled={disabled || isUpdating}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUpdating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    {tc('change')}
                    <ChevronDown
                      className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mode selection dropdown */}
        {isOpen && (
          <div className="space-y-2 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 shadow-lg">
            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-2">
              {t('modeSelector.selectMode')}
            </h4>
            {(Object.entries(WORKFLOW_MODE_CONFIGS) as [WorkflowMode, WorkflowModeConfig][]).map(
              ([mode, config]) => {
                const isSelected = mode === selectedMode;
                const ModeIcon = config.icon;

                return (
                  <button
                    key={mode}
                    onClick={() => handleModeSelect(mode)}
                    disabled={isSelected || disabled || isUpdating}
                    className={`w-full text-left p-3 rounded-lg border transition-all disabled:cursor-not-allowed ${
                      isSelected
                        ? `${config.bgColor} ${config.color} border-current`
                        : 'border-zinc-200 dark:border-zinc-600 hover:border-zinc-300 dark:hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-700/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-1.5 rounded-full ${isSelected ? 'bg-white dark:bg-zinc-800' : 'bg-zinc-100 dark:bg-zinc-700'}`}
                      >
                        <ModeIcon
                          className={`h-3.5 w-3.5 ${isSelected ? config.color : 'text-zinc-500 dark:text-zinc-400'}`}
                        />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-medium ${isSelected ? config.color : 'text-zinc-900 dark:text-zinc-100'}`}
                          >
                            {config.name}
                          </span>
                          {isSelected && (
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                              {t('modeSelector.current')}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                          {config.description}
                        </p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          <span>{config.estimatedTime}</span>
                          <span>{config.steps.join(' → ')}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              },
            )}

            <div className="pt-2 border-t border-zinc-100 dark:border-zinc-700">
              <button
                onClick={() => setIsOpen(false)}
                className="w-full px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 text-center"
              >
                {tc('close')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
