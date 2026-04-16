'use client';
// GoalWizard

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Sparkles,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Target,
} from 'lucide-react';
import type { Category } from '@/types';
import type { GoalFormData } from '../_hooks/useLearningGoals';
import { INITIAL_FORM_DATA } from '../_hooks/useLearningGoals';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';

type WizardStep = 'goal' | 'level' | 'schedule' | 'confirm';

type Props = {
  /** Available categories to associate the goal with. */
  categories: Category[];
  /** Called when the user completes the wizard and submits. */
  onSubmit: (formData: GoalFormData) => void;
  /** Called when the user cancels without submitting. */
  onCancel: () => void;
};

/**
 * Renders the four-step goal creation wizard.
 *
 * @param props - categories, onSubmit, onCancel
 */
export function GoalWizard({ categories, onSubmit, onCancel }: Props) {
  const t = useTranslations('learning');
  const tc = useTranslations('common');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);

  const WIZARD_STEPS: { key: WizardStep; label: string }[] = [
    { key: 'goal', label: t('goal') },
    { key: 'level', label: t('levelSetting') },
    { key: 'schedule', label: t('durationTime') },
    { key: 'confirm', label: t('confirm') },
  ];

  const [currentStep, setCurrentStep] = useState<WizardStep>('goal');
  const [formData, setFormData] = useState<GoalFormData>(INITIAL_FORM_DATA);

  const getStepIndex = (step: WizardStep) =>
    WIZARD_STEPS.findIndex((s) => s.key === step);

  const canProceed = (): boolean => {
    switch (currentStep) {
      case 'goal':
        return formData.title.trim().length > 0;
      case 'level':
      case 'schedule':
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
    if (idx > 0) setCurrentStep(WIZARD_STEPS[idx - 1].key);
  };

  const handleSubmit = () => onSubmit(formData);

  return (
    <div className="mb-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* Step tabs */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-700">
        {WIZARD_STEPS.map((step, idx) => (
          <button
            key={step.key}
            onClick={() => {
              // Allow free navigation only to already-visited steps
              if (idx <= getStepIndex(currentStep)) {
                setCurrentStep(step.key);
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

      <div className="p-6">
        {/* Step: goal */}
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

        {/* Step: level */}
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

        {/* Step: schedule */}
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
                  {formData.dailyHours}
                  {t('hoursPerDay')}
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

        {/* Step: confirm */}
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
                    {formData.dailyHours}
                    {t('hoursPerDayUnit')}
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

        {/* Navigation footer */}
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
                onClick={onCancel}
                className="px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              >
                {tc('cancel')}
              </button>
            )}
          </div>
          <div>
            {currentStep === 'confirm' ? (
              <button
                onClick={handleSubmit}
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
  );
}

export { Target };
