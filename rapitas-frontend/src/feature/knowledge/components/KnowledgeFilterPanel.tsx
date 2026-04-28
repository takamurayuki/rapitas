'use client';

import { useTranslations } from 'next-intl';
import type { KnowledgeCategory, ForgettingStage, ValidationStatus } from '../types';

interface KnowledgeFilterPanelProps {
  category: KnowledgeCategory | '';
  stage: ForgettingStage | '';
  validation: ValidationStatus | '';
  onCategoryChange: (v: KnowledgeCategory | '') => void;
  onStageChange: (v: ForgettingStage | '') => void;
  onValidationChange: (v: ValidationStatus | '') => void;
}

const categories: Array<KnowledgeCategory | ''> = [
  '',
  'procedure',
  'fact',
  'pattern',
  'preference',
  'insight',
  'general',
];
const stages: Array<ForgettingStage | ''> = ['', 'active', 'dormant', 'archived'];
const validations: Array<ValidationStatus | ''> = [
  '',
  'pending',
  'validated',
  'rejected',
  'conflict',
];

export function KnowledgeFilterPanel({
  category,
  stage,
  validation,
  onCategoryChange,
  onStageChange,
  onValidationChange,
}: KnowledgeFilterPanelProps) {
  const t = useTranslations('knowledge');
  const tc = useTranslations('common');

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={category}
        onChange={(e) => onCategoryChange(e.target.value as KnowledgeCategory | '')}
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
      >
        <option value="">
          {tc('all')} {t('category')}
        </option>
        {categories.filter(Boolean).map((c) => (
          <option key={c} value={c}>
            {t(`categories.${c}`)}
          </option>
        ))}
      </select>

      <select
        value={stage}
        onChange={(e) => onStageChange(e.target.value as ForgettingStage | '')}
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
      >
        <option value="">
          {tc('all')} {t('stage')}
        </option>
        {stages.filter(Boolean).map((s) => (
          <option key={s} value={s}>
            {t(`stages.${s}`)}
          </option>
        ))}
      </select>

      <select
        value={validation}
        onChange={(e) => onValidationChange(e.target.value as ValidationStatus | '')}
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
      >
        <option value="">
          {tc('all')} {t('validation')}
        </option>
        {validations.filter(Boolean).map((v) => (
          <option key={v} value={v}>
            {t(`validationStatuses.${v}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
