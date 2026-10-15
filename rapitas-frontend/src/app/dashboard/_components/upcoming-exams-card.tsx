/**
 * UpcomingExamsCard
 *
 * Dashboard card listing up to three upcoming exam goals with countdowns.
 * Pure presentational.
 */
'use client';
import { useTranslations } from 'next-intl';
import { Target } from 'lucide-react';
import type { ExamGoal } from '@/types';
import { ExamCountdown } from '@/components/exam-countdown/ExamCountdown';

interface UpcomingExamsCardProps {
  upcomingExams: ExamGoal[];
}

/**
 * Render the upcoming-exams card.
 *
 * @param props - Upcoming exam goals from the overview statistics. / 概要統計の今後の試験目標。
 */
export function UpcomingExamsCard({ upcomingExams }: UpcomingExamsCardProps) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-600 dark:text-zinc-300">
        <Target className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
        {t('upcomingExams')}
      </h2>

      {upcomingExams.length > 0 ? (
        <div className="space-y-3">
          {upcomingExams.slice(0, 3).map((exam) => (
            <div key={exam.id} className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {exam.name}
                </span>
                {exam.targetScore && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t('target')}: {exam.targetScore}
                  </span>
                )}
              </div>
              <ExamCountdown examDate={exam.examDate} color={exam.color} compact />
            </div>
          ))}

          {upcomingExams.length > 3 && (
            <a
              href="/exam-goals"
              className="block text-center text-sm text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {tc('other')} {upcomingExams.length - 3} {tc('items')}
            </a>
          )}
        </div>
      ) : (
        <div className="flex h-32 flex-col items-center justify-center text-zinc-500 dark:text-zinc-400">
          <Target className="mb-2 h-8 w-8 opacity-50" />
          <p className="text-sm">{t('noExamGoals')}</p>
          <a
            href="/exam-goals"
            className="mt-2 text-sm text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {t('addExamGoal')}
          </a>
        </div>
      )}
    </div>
  );
}
