'use client';
// TestCorrelationPage

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  TestCorrelationHeatmap,
  TestCorrelationDrilldown,
  useTestCorrelationMatrix,
} from '@/feature/test-correlation';

export default function TestCorrelationPage() {
  const t = useTranslations('testCorrelation');
  const { cells, loading } = useTestCorrelationMatrix(3);
  const [selectedCell, setSelectedCell] = useState<{
    changedFile: string;
    testFile: string;
  } | null>(null);

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-800 dark:text-zinc-100">
            {t('pageTitle')}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{t('pageDescription')}</p>
        </div>

        <TestCorrelationHeatmap
          cells={cells}
          loading={loading}
          onCellClick={(changedFile, testFile) => setSelectedCell({ changedFile, testFile })}
        />
      </div>

      {selectedCell && (
        <TestCorrelationDrilldown
          changedFile={selectedCell.changedFile}
          testFile={selectedCell.testFile}
          onClose={() => setSelectedCell(null)}
        />
      )}
    </div>
  );
}
