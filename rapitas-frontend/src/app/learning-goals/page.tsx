'use client';
import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { LearningGoal, GeneratedLearningPlan, Category } from '@/types';
import {
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Trash2,
  CheckCircle2,
  Lightbulb,
  Target,
  ListTodo,
  BookOpen,
  Clock,
  Calendar,
  ArrowRight,
  Loader2,
  BookMarked,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  GraduationCap,
  RefreshCw,
  Layers,
} from 'lucide-react';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { useLocaleStore } from '@/stores/localeStore';
import { toDateLocale } from '@/lib/utils';

const logger = createLogger('LearningGoalsPage');

// ウィザードのステップ
type WizardStep = 'goal' | 'level' | 'schedule' | 'confirm';

export default function LearningGoalsPage() {
  const t = useTranslations('learning');
  const tc = useTranslations('common');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);
  const { showToast } = useToast();

  const WIZARD_STEPS: { key: WizardStep; label: string }[] = [
    { key: 'goal', label: t('goal') },
    { key: 'level', label: t('levelSetting') },
    { key: 'schedule', label: t('durationTime') },
    { key: 'confirm', label: t('confirm') },
  ];
  const [goals, setGoals] = useState<LearningGoal[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [adapting, setAdapting] = useState(false);
  const [goalProgress, setGoalProgress] = useState<Record<number, { total: number; completed: number; rate: number }>>({});
  const [selectedGoal, setSelectedGoal] = useState<LearningGoal | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [currentStep, setCurrentStep] = useState<WizardStep>('goal');
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set());

  // ウィザードフォームデータ
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    currentLevel: '',
    targetLevel: '',
    deadline: '',
    dailyHours: 2,
    categoryId: undefined as number | undefined,
  });

  const fetchGoals = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/learning-goals`);
      if (res.ok) {
        setGoals(await res.json());
      }
    } catch (e) {
      logger.error('Failed to fetch learning goals:', e);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/categories`);
      if (res.ok) {
        const data = await res.json();
        setCategories(
          data.filter(
            (c: Category) => c.mode === 'learning' || c.mode === 'both',
          ),
        );
      }
    } catch (e) {
      logger.error('Failed to fetch categories:', e);
    }
  }, []);

  const fetchGoalProgress = useCallback(async (goalList: LearningGoal[]) => {
    const appliedGoals = goalList.filter((g) => g.isApplied && g.themeId);
    const progressMap: Record<number, { total: number; completed: number; rate: number }> = {};

    for (const goal of appliedGoals) {
      try {
        const res = await fetch(`${API_BASE_URL}/tasks?themeId=${goal.themeId}`);
        if (res.ok) {
          const data = await res.json();
          const tasks = Array.isArray(data) ? data : data.tasks || [];
          const parentTasks = tasks.filter((t: { parentId: number | null }) => !t.parentId);
          const total = parentTasks.length;
          const completed = parentTasks.filter((t: { status: string }) => t.status === 'done').length;
          progressMap[goal.id] = { total, completed, rate: total > 0 ? completed / total : 0 };
        }
      } catch (e) {
        logger.error(`Failed to fetch progress for goal ${goal.id}:`, e);
      }
    }
    setGoalProgress(progressMap);
  }, []);

  useEffect(() => {
    Promise.all([fetchGoals(), fetchCategories()]).finally(() =>
      setLoading(false),
    );
  }, [fetchGoals, fetchCategories]);

  useEffect(() => {
    if (goals.length > 0) {
      fetchGoalProgress(goals);
    }
  }, [goals, fetchGoalProgress]);

  const handleAdaptPlan = async (goal: LearningGoal) => {
    setAdapting(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/learning-goals/${goal.id}/adapt`,
        { method: 'POST' },
      );
      if (res.ok) {
        const result = await res.json();
        if (result.success) {
          showToast(t('adaptSuccess'), 'success');
          await fetchGoals();
          const updated = await fetch(`${API_BASE_URL}/learning-goals/${goal.id}`);
          if (updated.ok) {
            setSelectedGoal(await updated.json());
          }
        } else {
          showToast(result.error || t('adaptFailed'), 'error');
        }
      }
    } catch (e) {
      logger.error('Failed to adapt plan:', e);
      showToast(tc('errorOccurred'), 'error');
    } finally {
      setAdapting(false);
    }
  };

  const resetWizard = () => {
    setFormData({
      title: '',
      description: '',
      currentLevel: '',
      targetLevel: '',
      deadline: '',
      dailyHours: 2,
      categoryId: undefined,
    });
    setCurrentStep('goal');
    setShowWizard(false);
  };

  const handleCreateGoal = async () => {
    if (!formData.title.trim()) return;

    try {
      const res = await fetch(`${API_BASE_URL}/learning-goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formData.title,
          description: formData.description || undefined,
          currentLevel: formData.currentLevel || undefined,
          targetLevel: formData.targetLevel || undefined,
          deadline: formData.deadline || undefined,
          dailyHours: formData.dailyHours,
          categoryId: formData.categoryId,
        }),
      });

      if (res.ok) {
        const newGoal = await res.json();
        showToast(t('goalCreated'), 'success');
        resetWizard();
        await fetchGoals();
        // 自動的にプラン生成を開始
        handleGeneratePlan(newGoal.id);
      }
    } catch (e) {
      logger.error('Failed to create learning goal:', e);
      showToast(t('createFailed'), 'error');
    }
  };

  const handleGeneratePlan = async (goalId: number) => {
    setGenerating(true);
    // 対象の目標を選択状態にする
    const targetGoal = goals.find((g) => g.id === goalId);
    if (targetGoal) setSelectedGoal(targetGoal);

    try {
      const res = await fetch(
        `${API_BASE_URL}/learning-goals/${goalId}/generate-plan`,
        {
          method: 'POST',
        },
      );

      if (res.ok) {
        const result = await res.json();
        showToast(
          result.source === 'ai'
            ? t('aiGeneratedPlan')
            : t('planGenerated'),
          'success',
        );
        await fetchGoals();
        // 更新された目標を選択
        const updated = await fetch(`${API_BASE_URL}/learning-goals/${goalId}`);
        if (updated.ok) {
          setSelectedGoal(await updated.json());
        }
      } else {
        showToast(t('planGenerateFailed'), 'error');
      }
    } catch (e) {
      logger.error('Failed to generate plan:', e);
      showToast(tc('errorOccurred'), 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleApplyPlan = async (goal: LearningGoal) => {
    if (goal.isApplied) {
      showToast(t('alreadyApplied'), 'info');
      return;
    }
    if (
      !confirm(t('applyConfirm'))
    )
      return;

    setApplying(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/learning-goals/${goal.id}/apply`,
        {
          method: 'POST',
        },
      );
      if (res.ok) {
        const result = await res.json();
        if (result.success) {
          showToast(
            t('tasksCreated', { count: result.createdTaskCount, theme: result.themeName }),
            'success',
          );
          await fetchGoals();
          const updated = await fetch(
            `${API_BASE_URL}/learning-goals/${goal.id}`,
          );
          if (updated.ok) {
            setSelectedGoal(await updated.json());
          }
        } else {
          showToast(result.error || t('applyFailed'), 'error');
        }
      }
    } catch (e) {
      logger.error('Failed to apply plan:', e);
      showToast(tc('errorOccurred'), 'error');
    } finally {
      setApplying(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('deleteConfirm'))) return;
    try {
      const res = await fetch(`${API_BASE_URL}/learning-goals/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        showToast(t('goalDeleted'), 'success');
        if (selectedGoal?.id === id) setSelectedGoal(null);
        await fetchGoals();
      }
    } catch (e) {
      logger.error('Failed to delete:', e);
      showToast(t('deleteFailed'), 'error');
    }
  };

  const togglePhase = (index: number) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const getParsedPlan = (goal: LearningGoal): GeneratedLearningPlan | null => {
    if (!goal.generatedPlan) return null;
    try {
      return JSON.parse(goal.generatedPlan) as GeneratedLearningPlan;
    } catch {
      return null;
    }
  };

  const goToStep = (step: WizardStep) => {
    setCurrentStep(step);
  };

  const getStepIndex = (step: WizardStep) =>
    WIZARD_STEPS.findIndex((s) => s.key === step);

  const canProceed = (): boolean => {
    switch (currentStep) {
      case 'goal':
        return formData.title.trim().length > 0;
      case 'level':
        return true; // optional
      case 'schedule':
        return true; // has defaults
      case 'confirm':
        return true;
      default:
        return false;
    }
  };

  const nextStep = () => {
    const idx = getStepIndex(currentStep);
    if (idx < WIZARD_STEPS.length - 1) {
      setCurrentStep(WIZARD_STEPS[idx + 1].key);
    }
  };

  const prevStep = () => {
    const idx = getStepIndex(currentStep);
    if (idx > 0) {
      setCurrentStep(WIZARD_STEPS[idx - 1].key);
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
          <div className="h-64 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BookMarked className="w-8 h-8 text-emerald-500" />
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {t('title')}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t('subtitle')}
            </p>
          </div>
        </div>
        {!showWizard && (
          <button
            onClick={() => setShowWizard(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <Target className="w-4 h-4" />
            {t('newGoal')}
          </button>
        )}
      </div>

      {/* ウィザード */}
      {showWizard && (
        <div className="mb-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          {/* ステップインジケーター */}
          <div className="flex border-b border-zinc-200 dark:border-zinc-700">
            {WIZARD_STEPS.map((step, idx) => (
              <button
                key={step.key}
                onClick={() => {
                  // 現在のステップ以前のステップには自由に戻れる
                  if (idx <= getStepIndex(currentStep)) {
                    goToStep(step.key);
                  }
                }}
                className={`flex-1 py-3 px-4 text-sm font-medium transition-colors relative ${
                  step.key === currentStep
                    ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                    : idx < getStepIndex(currentStep)
                      ? 'text-emerald-500 dark:text-emerald-400 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700/50'
                      : 'text-zinc-400 dark:text-zinc-500 cursor-default'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      step.key === currentStep
                        ? 'bg-emerald-600 text-white'
                        : idx < getStepIndex(currentStep)
                          ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
                          : 'bg-zinc-200 dark:bg-zinc-600 text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    {idx < getStepIndex(currentStep) ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      idx + 1
                    )}
                  </span>
                  <span className="hidden sm:inline">{step.label}</span>
                </div>
              </button>
            ))}
          </div>

          {/* ステップコンテンツ */}
          <div className="p-6">
            {/* Step 1: 学習目標 */}
            {currentStep === 'goal' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
                    {t('whatToLearn')}
                  </h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                    {t('whatToLearnDescription')}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {t('goalLabel')}
                  </label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) =>
                      setFormData({ ...formData, title: e.target.value })
                    }
                    placeholder={t('goalPlaceholder')}
                    className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-base focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {t('detailedDescription')}
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    placeholder={t('detailedDescriptionPlaceholder')}
                    rows={3}
                    className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                  />
                </div>
              </div>
            )}

            {/* Step 2: レベル設定 */}
            {currentStep === 'level' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
                    {t('levelSettingTitle')}
                  </h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                    {t('levelSettingDescription')}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {t('currentLevel')}
                  </label>
                  <input
                    type="text"
                    value={formData.currentLevel}
                    onChange={(e) =>
                      setFormData({ ...formData, currentLevel: e.target.value })
                    }
                    placeholder={t('currentLevelPlaceholder')}
                    className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {t('targetLevel')}
                  </label>
                  <input
                    type="text"
                    value={formData.targetLevel}
                    onChange={(e) =>
                      setFormData({ ...formData, targetLevel: e.target.value })
                    }
                    placeholder={t('targetLevelPlaceholder')}
                    className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            )}

            {/* Step 3: 期間・時間 */}
            {currentStep === 'schedule' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
                    {t('whenToAchieve')}
                  </h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                    {t('whenToAchieveDescription')}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {t('deadline')}
                  </label>
                  <input
                    type="date"
                    value={formData.deadline}
                    onChange={(e) =>
                      setFormData({ ...formData, deadline: e.target.value })
                    }
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    autoFocus
                  />
                  <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                    {t('deadlineDefault')}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {t('dailyStudyTime')}
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0.5}
                      max={8}
                      step={0.5}
                      value={formData.dailyHours}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          dailyHours: parseFloat(e.target.value),
                        })
                      }
                      className="flex-1 accent-emerald-600"
                    />
                    <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400 min-w-[4rem] text-center">
                      {formData.dailyHours}{t('hoursPerDay')}
                    </span>
                  </div>
                </div>
                {categories.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      {t('categoryOptional')}
                    </label>
                    <select
                      value={formData.categoryId ?? ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          categoryId: e.target.value
                            ? parseInt(e.target.value)
                            : undefined,
                        })
                      }
                      className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="">{t('categoryAuto')}</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Step 4: 確認 */}
            {currentStep === 'confirm' && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
                  {t('confirmContent')}
                </h2>
                <div className="bg-zinc-50 dark:bg-zinc-700/50 rounded-lg p-4 space-y-3">
                  <div>
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      {t('goal')}
                    </span>
                    <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                      {formData.title}
                    </p>
                  </div>
                  {formData.description && (
                    <div>
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        {t('detail')}
                      </span>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {formData.description}
                      </p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        {t('currentLevel')}
                      </span>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {formData.currentLevel || t('unspecified')}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        {t('targetLevel')}
                      </span>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {formData.targetLevel || t('unspecified')}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        {t('deadline')}
                      </span>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {formData.deadline
                          ? new Date(formData.deadline).toLocaleDateString(
                              dateLocale,
                            )
                          : t('deadlineUnset')}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        {t('studyTime')}
                      </span>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {formData.dailyHours}{t('hoursPerDayUnit')}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-3">
                  <p className="text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 shrink-0" />
                    {t('aiAutoGenerate')}
                  </p>
                </div>
              </div>
            )}

            {/* ナビゲーションボタン */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <div>
                {currentStep !== 'goal' ? (
                  <button
                    onClick={prevStep}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    {tc('back')}
                  </button>
                ) : (
                  <button
                    onClick={resetWizard}
                    className="px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  >
                    {tc('cancel')}
                  </button>
                )}
              </div>
              <div>
                {currentStep === 'confirm' ? (
                  <button
                    onClick={handleCreateGoal}
                    className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                  >
                    <Sparkles className="w-4 h-4" />
                    {t('createAndGenerate')}
                  </button>
                ) : (
                  <button
                    onClick={nextStep}
                    disabled={!canProceed()}
                    className="flex items-center gap-1.5 px-5 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('next')}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* メインコンテンツ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左: 目標一覧 */}
        <div className="lg:col-span-1">
          {goals.length > 0 ? (
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
              <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-3">
                {t('goalList')}
              </h2>
              <div className="space-y-2">
                {goals.map((goal) => (
                  <button
                    key={goal.id}
                    onClick={() => {
                      setSelectedGoal(goal);
                      setExpandedPhases(new Set());
                    }}
                    className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-colors ${
                      selectedGoal?.id === goal.id
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-300 dark:border-emerald-700'
                        : 'bg-zinc-50 dark:bg-zinc-700/50 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-zinc-800 dark:text-zinc-200 text-sm truncate">
                          {goal.title}
                        </span>
                        {goal.isApplied && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded-full ${
                            goal.status === 'active'
                              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                              : goal.status === 'completed'
                                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                : 'bg-zinc-100 dark:bg-zinc-600 text-zinc-600 dark:text-zinc-300'
                          }`}
                        >
                          {goal.status === 'active'
                            ? t('statusActive')
                            : goal.status === 'completed'
                              ? t('statusCompleted')
                              : t('statusArchived')}
                        </span>
                        {goal.deadline && (
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            〜
                            {new Date(goal.deadline).toLocaleDateString(
                              dateLocale,
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            !showWizard && (
              <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-8 text-center">
                <Target className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {t('noGoalsYet')}
                  <br />
                  {t('startFromNewGoal')}
                </p>
              </div>
            )
          )}
        </div>

        {/* 右: 詳細・プラン表示 */}
        <div className="lg:col-span-2">
          {generating ? (
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-12 text-center">
              <Loader2 className="w-12 h-12 mx-auto text-emerald-500 animate-spin mb-4" />
              <h3 className="text-lg font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                {t('aiGenerating')}
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {t('analyzingSources')}
              </p>
            </div>
          ) : selectedGoal ? (
            <GoalDetailPanel
              goal={selectedGoal}
              plan={getParsedPlan(selectedGoal)}
              applying={applying}
              adapting={adapting}
              progress={goalProgress[selectedGoal.id]}
              expandedPhases={expandedPhases}
              onTogglePhase={togglePhase}
              onApply={() => handleApplyPlan(selectedGoal)}
              onRegenerate={() => handleGeneratePlan(selectedGoal.id)}
              onDelete={() => handleDelete(selectedGoal.id)}
              onAdapt={() => handleAdaptPlan(selectedGoal)}
            />
          ) : (
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-12 text-center">
              <BookMarked className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
              <h3 className="text-lg font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                {t('selectGoal')}
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
                {t('selectGoalDescription')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 目標詳細パネルコンポーネント
function GoalDetailPanel({
  goal,
  plan,
  applying,
  adapting,
  progress,
  expandedPhases,
  onTogglePhase,
  onApply,
  onRegenerate,
  onDelete,
  onAdapt,
}: {
  goal: LearningGoal;
  plan: GeneratedLearningPlan | null;
  applying: boolean;
  adapting: boolean;
  progress?: { total: number; completed: number; rate: number };
  expandedPhases: Set<number>;
  onTogglePhase: (index: number) => void;
  onApply: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onAdapt: () => void;
}) {
  const t = useTranslations('learning');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);
  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
      {/* ヘッダー */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            {goal.title}
            {goal.isApplied && (
              <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium rounded-full">
                {t('applied')}
              </span>
            )}
          </h2>
          {goal.description && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
              {goal.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {plan && !goal.isApplied && (
            <button
              onClick={onApply}
              disabled={applying}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {applying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t('applying')}</span>
                </>
              ) : (
                <>
                  <ListTodo className="w-4 h-4" />
                  <span>{t('applyToTasks')}</span>
                </>
              )}
            </button>
          )}
          {!goal.isApplied && (
            <button
              onClick={onRegenerate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors text-zinc-700 dark:text-zinc-300"
            >
              <Sparkles className="w-4 h-4" />
              <span>{t('regenerate')}</span>
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* メタ情報 */}
      <div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
        {goal.currentLevel && (
          <div className="flex items-center gap-1.5">
            <ArrowRight className="w-4 h-4" />
            <span>
              {goal.currentLevel} → {goal.targetLevel || t('unspecified')}
            </span>
          </div>
        )}
        {goal.deadline && (
          <div className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4" />
            <span>〜{new Date(goal.deadline).toLocaleDateString(dateLocale)}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Clock className="w-4 h-4" />
          <span>{goal.dailyHours}{t('hoursPerDayUnit')}</span>
        </div>
      </div>

      {/* 進捗バー + アクションボタン */}
      {goal.isApplied && progress && (
        <div className="mb-6 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t('phaseProgress')}
              </span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {progress.completed}/{progress.total} ({Math.round(progress.rate * 100)}%)
              </span>
            </div>
            <div className="w-full h-2.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.round(progress.rate * 100)}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={`/flashcards?learningGoalId=${goal.id}`}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
            >
              <Layers className="w-4 h-4" />
              {t('flashcardReview')}
            </a>
            {progress.rate >= 0.3 && (
              <button
                onClick={onAdapt}
                disabled={adapting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50"
              >
                {adapting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                {t('adaptPlan')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 学習プラン */}
      {plan ? (
        <>
          {/* フェーズ一覧 */}
          <div className="space-y-3 mb-6">
            {plan.phases.map((phase, index) => (
              <div
                key={index}
                className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden"
              >
                <button
                  onClick={() => onTogglePhase(index)}
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold text-sm shrink-0">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">
                      {phase.name}
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {phase.days}{t('daysCount')} ・ {phase.tasks.length}{t('tasksCount')}
                      {phase.description && ` ・ ${phase.description}`}
                    </p>
                  </div>
                  {expandedPhases.has(index) ? (
                    <ChevronUp className="w-5 h-5 text-zinc-400 shrink-0" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-zinc-400 shrink-0" />
                  )}
                </button>
                {expandedPhases.has(index) && (
                  <div className="border-t border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
                    {phase.tasks.map((task, taskIndex) => (
                      <div
                        key={taskIndex}
                        className="bg-zinc-50 dark:bg-zinc-700/30 rounded-lg p-3"
                      >
                        <div className="flex items-start gap-2">
                          <BookOpen className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" />
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-sm text-zinc-800 dark:text-zinc-200">
                              {task.title}
                            </h4>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 whitespace-pre-wrap">
                              {task.description}
                            </p>
                            <div className="flex items-center gap-3 mt-2">
                              {task.estimatedHours && (
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {task.estimatedHours}h
                                </span>
                              )}
                              {task.priority && (
                                <span
                                  className={`text-xs px-1.5 py-0.5 rounded-full ${
                                    task.priority === 'high'
                                      ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                                      : task.priority === 'low'
                                        ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                                        : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                  }`}
                                >
                                  {task.priority === 'high'
                                    ? t('priorityHigh')
                                    : task.priority === 'low'
                                      ? t('priorityLow')
                                      : t('priorityMedium')}
                                </span>
                              )}
                            </div>
                            {/* サブタスク */}
                            {task.subtasks && task.subtasks.length > 0 && (
                              <div className="mt-2 pl-3 border-l-2 border-emerald-200 dark:border-emerald-800 space-y-1.5">
                                {task.subtasks.map((sub, subIndex) => (
                                  <div key={subIndex} className="text-xs">
                                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                                      {sub.title}
                                    </span>
                                    {sub.description && (
                                      <span className="text-zinc-500 dark:text-zinc-400">
                                        {' '}
                                        - {sub.description}
                                      </span>
                                    )}
                                    {sub.estimatedHours && (
                                      <span className="text-zinc-400 dark:text-zinc-500">
                                        {' '}
                                        ({sub.estimatedHours}h)
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* おすすめリソース */}
          {plan.recommendedResources &&
            plan.recommendedResources.length > 0 && (
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 mb-4">
                <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-2 flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />
                  {t('recommendedResources')}
                </h3>
                <div className="space-y-2">
                  {plan.recommendedResources.map((resource, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-sm">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 mt-0.5 ${
                          resource.type === 'book'
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                            : resource.type === 'course'
                              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                              : resource.type === 'video'
                                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                                : resource.type === 'practice'
                                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                  : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        }`}
                      >
                        {resource.type === 'book'
                          ? t('resourceBook')
                          : resource.type === 'course'
                            ? t('resourceCourse')
                            : resource.type === 'video'
                              ? t('resourceVideo')
                              : resource.type === 'practice'
                                ? t('resourcePractice')
                                : t('resourceWeb')}
                      </span>
                      <div>
                        <span className="font-medium text-blue-800 dark:text-blue-200">
                          {resource.title}
                        </span>
                        <span className="text-blue-600 dark:text-blue-300">
                          {' '}
                          - {resource.description}
                        </span>
                        {resource.url && (
                          <a
                            href={resource.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 ml-1 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* ヒント */}
          {plan.tips && plan.tips.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 mb-4">
              <h3 className="font-semibold text-amber-800 dark:text-amber-200 mb-2 flex items-center gap-2">
                <Lightbulb className="w-4 h-4" />
                {t('learningTips')}
              </h3>
              <ul className="space-y-1">
                {plan.tips.map((tip, index) => (
                  <li
                    key={index}
                    className="text-sm text-amber-700 dark:text-amber-300"
                  >
                    • {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* タスク適用の案内 */}
          {!goal.isApplied && (
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-4">
              <p className="text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <ListTodo className="w-4 h-4 shrink-0" />
                {t('applyTaskGuide')}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-8">
          <Sparkles className="w-10 h-10 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('noPlanYet')}
          </p>
          <button
            onClick={onRegenerate}
            className="mt-3 flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors mx-auto"
          >
            <Sparkles className="w-4 h-4" />
            {t('generatePlan')}
          </button>
        </div>
      )}
    </div>
  );
}
