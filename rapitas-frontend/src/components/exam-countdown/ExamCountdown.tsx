'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useLocaleStore } from '@/stores/localeStore';
import { toDateLocale } from '@/lib/utils';

type ExamCountdownProps = {
  examDate: string;
  color: string;
  compact?: boolean;
};

export function ExamCountdown({
  examDate,
  color,
  compact = false,
}: ExamCountdownProps) {
  const t = useTranslations('examCountdown');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);

  const { daysRemaining, examDateObj, isUrgent, isNear, isPast, isToday } =
    useMemo(() => {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const exam = new Date(examDate);
      exam.setHours(0, 0, 0, 0);
      const diff = Math.ceil(
        (exam.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      return {
        daysRemaining: diff,
        examDateObj: exam,
        isUrgent: diff > 0 && diff <= 7,
        isNear: diff > 7 && diff <= 30,
        isPast: diff < 0,
        isToday: diff === 0,
      };
    }, [examDate]);

  const month = examDateObj.getMonth() + 1;
  const day = examDateObj.getDate();
  const weekday = examDateObj.toLocaleDateString(dateLocale, {
    weekday: 'short',
  });
  const year = examDateObj.getFullYear();

  const statusColor = isToday
    ? '#F59E0B'
    : isPast
      ? '#9CA3AF'
      : isUrgent
        ? '#EF4444'
        : isNear
          ? '#F59E0B'
          : color;

  if (compact) {
    return (
      <div className="flex items-center gap-3">
        {/* ミニ日めくり */}
        <div
          className="relative flex flex-col items-center rounded-lg overflow-hidden shadow-sm border border-zinc-200 dark:border-zinc-600"
          style={{ minWidth: 52 }}
        >
          {/* 上部: 月 */}
          <div
            className="w-full text-center text-[10px] font-bold text-white py-0.5 leading-tight"
            style={{ backgroundColor: statusColor }}
          >
            {t('monthLabel', { month })}
          </div>
          {/* 日付 */}
          <div className="w-full text-center bg-white dark:bg-zinc-800 py-1 px-1">
            <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50 leading-none">
              {day}
            </span>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 ml-0.5">
              ({weekday})
            </span>
          </div>
        </div>
        {/* 残り日数 */}
        <div>
          <span className="text-lg font-bold" style={{ color: statusColor }}>
            {isToday
              ? t('today')
              : isPast
                ? t('daysElapsed', { count: Math.abs(daysRemaining) })
                : t('daysLeft', { count: daysRemaining })}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      {/* 日めくりカレンダー */}
      <div
        className="relative flex flex-col items-center rounded-xl overflow-hidden shadow-md border border-zinc-200 dark:border-zinc-600"
        style={{ minWidth: 80 }}
      >
        {/* 上部: 年月ヘッダー */}
        <div
          className="w-full text-center text-xs font-bold text-white py-1"
          style={{ backgroundColor: statusColor }}
        >
          {t('yearMonthLabel', { year, month })}
        </div>
        {/* 中央: 日付（大きく） */}
        <div className="w-full text-center bg-white dark:bg-zinc-800 py-2 px-2">
          <div className="text-3xl font-extrabold text-zinc-900 dark:text-zinc-50 leading-none">
            {day}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {weekday}{t('weekdayLabel')}
          </div>
        </div>
        {/* 下部: ちぎり線風の装飾 */}
        <div
          className="w-full h-1"
          style={{
            backgroundImage: `repeating-linear-gradient(90deg, ${statusColor}33 0px, ${statusColor}33 4px, transparent 4px, transparent 8px)`,
          }}
        />
      </div>

      {/* カウントダウン数字 */}
      <div className="flex flex-col items-start">
        {isToday ? (
          <div className="flex items-baseline gap-1">
            <span
              className="text-3xl font-extrabold"
              style={{ color: statusColor }}
            >
              {t('examDay')}
            </span>
          </div>
        ) : isPast ? (
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold text-zinc-400">
              {Math.abs(daysRemaining)}
            </span>
            <span className="text-sm font-medium text-zinc-400">{t('daysElapsedUnit')}</span>
          </div>
        ) : (
          <>
            <div className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
              {t('remaining')}
            </div>
            <div className="flex items-baseline gap-1">
              <span
                className="text-3xl font-extrabold tabular-nums"
                style={{ color: statusColor }}
              >
                {daysRemaining}
              </span>
              <span
                className="text-sm font-medium"
                style={{ color: statusColor }}
              >
                {t('dayUnit')}
              </span>
            </div>
            {daysRemaining > 7 && (
              <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                {t('weeksAndDays', { weeks: Math.floor(daysRemaining / 7), days: daysRemaining % 7 })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
