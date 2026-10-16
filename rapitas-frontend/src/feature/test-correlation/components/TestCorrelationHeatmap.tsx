'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Grid3x3 } from 'lucide-react';
import type { CorrelationCell } from '../test-correlation.types';

interface TestCorrelationHeatmapProps {
  cells: CorrelationCell[];
  loading: boolean;
  onCellClick: (changedFile: string, testFile: string) => void;
}

/**
 * Positive correlations (failure risk) shade indigo; negative correlations
 * (changing the file makes the test more likely to pass) shade blue for
 * visual distinction — null (undefined) correlation is neutral gray.
 * Declared as a static map because Tailwind's JIT scanner cannot see
 * dynamically interpolated class names (e.g. `bg-indigo-${scale}`).
 */
const COLOR_CLASSES: Record<string, string> = {
  'pos-100': 'bg-indigo-100 dark:bg-indigo-900/30',
  'pos-200': 'bg-indigo-200 dark:bg-indigo-800/40',
  'pos-300': 'bg-indigo-300 dark:bg-indigo-700/50',
  'pos-400': 'bg-indigo-400 dark:bg-indigo-600/60',
  'pos-500': 'bg-indigo-500 dark:bg-indigo-500/70',
  'neg-100': 'bg-blue-100 dark:bg-blue-900/30',
  'neg-200': 'bg-blue-200 dark:bg-blue-800/40',
  'neg-300': 'bg-blue-300 dark:bg-blue-700/50',
  'neg-400': 'bg-blue-400 dark:bg-blue-600/60',
  'neg-500': 'bg-blue-500 dark:bg-blue-500/70',
  neutral: 'bg-zinc-100 dark:bg-zinc-800',
};

/**
 * Resolves the Tailwind class for a correlation cell from the static COLOR_CLASSES map.
 *
 * @param correlation - Pearson r, or null when undefined / ピアソン相関係数
 * @returns Tailwind background class / 背景色クラス
 */
function resolveColorClass(correlation: number | null): string {
  if (correlation === null) return COLOR_CLASSES.neutral;
  const magnitude = Math.abs(correlation);
  const scale =
    magnitude < 0.2
      ? 100
      : magnitude < 0.4
        ? 200
        : magnitude < 0.6
          ? 300
          : magnitude < 0.8
            ? 400
            : 500;
  const sign = correlation >= 0 ? 'pos' : 'neg';
  return COLOR_CLASSES[`${sign}-${scale}`];
}

export function TestCorrelationHeatmap({
  cells,
  loading,
  onCellClick,
}: TestCorrelationHeatmapProps) {
  const t = useTranslations('testCorrelation.heatmap');

  const { changedFiles, testFiles, cellMap } = useMemo(() => {
    const changedFileSet = new Set<string>();
    const testFileSet = new Set<string>();
    const map = new Map<string, CorrelationCell>();
    for (const cell of cells) {
      changedFileSet.add(cell.changedFile);
      testFileSet.add(cell.testFile);
      map.set(`${cell.changedFile}\u0000${cell.testFile}`, cell);
    }
    return {
      changedFiles: Array.from(changedFileSet).sort(),
      testFiles: Array.from(testFileSet).sort(),
      cellMap: map,
    };
  }, [cells]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
          <div className="h-48 bg-zinc-200 dark:bg-zinc-700 rounded-lg" />
        </div>
      </div>
    );
  }

  if (changedFiles.length === 0 || testFiles.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
        <h2 className="text-sm font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-2 mb-3">
          <Grid3x3 className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
          {t('title')}
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-500 py-8 text-center">{t('empty')}</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
      <h2 className="text-sm font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-2 mb-3">
        <Grid3x3 className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
        {t('title')}
      </h2>

      <div className="overflow-x-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="text-left text-[10px] text-zinc-500 dark:text-zinc-400 pr-2 pb-1 sticky left-0 bg-white dark:bg-zinc-900">
                {t('testFileAxis')} \ {t('changedFileAxis')}
              </th>
              {changedFiles.map((changedFile) => (
                <th
                  key={changedFile}
                  className="text-[9px] text-zinc-500 dark:text-zinc-500 font-normal px-1 pb-1 max-w-[80px] truncate"
                  title={changedFile}
                >
                  {changedFile.split('/').pop()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {testFiles.map((testFile) => (
              <tr key={testFile}>
                <td
                  className="text-[10px] text-zinc-600 dark:text-zinc-400 pr-2 max-w-[160px] truncate sticky left-0 bg-white dark:bg-zinc-900"
                  title={testFile}
                >
                  {testFile.split('/').pop()}
                </td>
                {changedFiles.map((changedFile) => {
                  const cell = cellMap.get(`${changedFile}\u0000${testFile}`);
                  if (!cell) {
                    return <td key={changedFile} className="p-0.5" />;
                  }
                  const confidenceKey =
                    cell.confidence === 'high'
                      ? 'confidenceHigh'
                      : cell.confidence === 'medium'
                        ? 'confidenceMedium'
                        : 'confidenceLow';
                  const correlationLabel =
                    cell.correlation === null ? t('noCorrelation') : cell.correlation.toFixed(2);
                  const titleParts = [
                    t('cellTitle', { changedFile, testFile }),
                    t('correlationLabel', { value: correlationLabel }),
                    t('sampleSizeLabel', { count: cell.sampleSize }),
                    t(confidenceKey),
                    ...(cell.nonDeterministic ? [t('nonDeterministicFlag')] : []),
                  ];
                  return (
                    <td key={changedFile} className="p-0.5">
                      <button
                        type="button"
                        onClick={() => onCellClick(changedFile, testFile)}
                        title={titleParts.join(' / ')}
                        aria-label={titleParts.join(' / ')}
                        className={`w-6 h-6 rounded-sm cursor-pointer hover:ring-2 hover:ring-indigo-300 dark:hover:ring-indigo-500 transition-all relative ${resolveColorClass(cell.correlation)} ${
                          cell.confidence === 'low' ? 'opacity-60' : ''
                        }`}
                      >
                        {cell.nonDeterministic && (
                          <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-amber-500" />
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
