'use client';
// GenerateCardsModal

import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';

interface GenerateCardsModalProps {
  topic: string;
  count: number;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  language: 'ja' | 'en';
  isGenerating: boolean;
  onTopicChange: (v: string) => void;
  onCountChange: (n: number) => void;
  onDifficultyChange: (d: 'beginner' | 'intermediate' | 'advanced') => void;
  onLanguageChange: (lang: 'ja' | 'en') => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

/**
 * Modal for generating flashcards using AI from a topic description.
 *
 * @param props - See GenerateCardsModalProps
 */
export function GenerateCardsModal({
  topic,
  count,
  difficulty,
  language,
  isGenerating,
  onTopicChange,
  onCountChange,
  onDifficultyChange,
  onLanguageChange,
  onSubmit,
  onClose,
}: GenerateCardsModalProps) {
  const t = useTranslations('flashcards');
  const tc = useTranslations('common');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-zinc-800 rounded-xl w-full max-w-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
            {t('generateTitle')}
          </h2>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t('topic')}
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => onTopicChange(e.target.value)}
              placeholder={t('topicExample')}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
              required
              disabled={isGenerating}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {t('generationCount')}
              </label>
              <select
                value={count}
                onChange={(e) => onCountChange(Number(e.target.value))}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                disabled={isGenerating}
              >
                <option value={5}>{t('cards5')}</option>
                <option value={10}>{t('cards10')}</option>
                <option value={15}>{t('cards15')}</option>
                <option value={20}>{t('cards20')}</option>
                <option value={30}>{t('cards30')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {t('difficulty')}
              </label>
              <select
                value={difficulty}
                onChange={(e) =>
                  onDifficultyChange(
                    e.target.value as 'beginner' | 'intermediate' | 'advanced',
                  )
                }
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                disabled={isGenerating}
              >
                <option value="beginner">{tc('beginner')}</option>
                <option value="intermediate">{tc('intermediate')}</option>
                <option value="advanced">{tc('advanced')}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {tc('language')}
            </label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="language"
                  value="ja"
                  checked={language === 'ja'}
                  onChange={(e) => onLanguageChange(e.target.value as 'ja')}
                  className="mr-2"
                  disabled={isGenerating}
                />
                {tc('japanese')}
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="language"
                  value="en"
                  checked={language === 'en'}
                  onChange={(e) => onLanguageChange(e.target.value as 'en')}
                  className="mr-2"
                  disabled={isGenerating}
                />
                {tc('english')}
              </label>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isGenerating}
              className="flex-1 px-4 py-2 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg disabled:opacity-50"
            >
              {tc('cancel')}
            </button>
            <button
              type="submit"
              disabled={isGenerating}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {t('generating')}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  {t('generate')}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
