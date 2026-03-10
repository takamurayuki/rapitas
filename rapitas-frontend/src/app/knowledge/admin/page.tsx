'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Settings, Loader2 } from 'lucide-react';
import { useMemoryStats } from '@/feature/knowledge/hooks/useMemoryStats';
import { MemoryQueueStatus } from '@/feature/knowledge/components/MemoryQueueStatus';
import { KnowledgeTimeline } from '@/feature/knowledge/components/KnowledgeTimeline';
import { API_BASE_URL } from '@/utils/api';

export default function MemoryAdminPage() {
  const t = useTranslations('knowledge.admin');
  const tc = useTranslations('common');

  const {
    queueStatus,
    consolidationRuns,
    isLoading,
    triggerConsolidation,
    triggerForgettingSweep,
  } = useMemoryStats();

  const [isConsolidating, setIsConsolidating] = useState(false);
  const [isSweeping, setIsSweeping] = useState(false);
  const [ragQuery, setRagQuery] = useState('');
  const [ragResult, setRagResult] = useState<string | null>(null);
  const [isTestingRag, setIsTestingRag] = useState(false);

  const handleConsolidate = async () => {
    setIsConsolidating(true);
    try {
      await triggerConsolidation();
    } finally {
      setIsConsolidating(false);
    }
  };

  const handleSweep = async () => {
    setIsSweeping(true);
    try {
      await triggerForgettingSweep();
    } finally {
      setIsSweeping(false);
    }
  };

  const handleRagTest = async () => {
    if (!ragQuery.trim()) return;
    setIsTestingRag(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/memory/rag/test?q=${encodeURIComponent(ragQuery)}`,
      );
      if (res.ok) {
        const data = await res.json();
        setRagResult(data.contextText || 'No results');
      }
    } finally {
      setIsTestingRag(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <Settings className="h-8 w-8 text-indigo-500" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('description')}
          </p>
        </div>
      </div>

      {/* Queue Status */}
      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('queueStatus')}
        </h2>
        {queueStatus && <MemoryQueueStatus status={queueStatus} />}
      </section>

      {/* Actions */}
      <section className="mb-6 flex gap-3">
        <button
          onClick={handleConsolidate}
          disabled={isConsolidating}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isConsolidating && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('triggerConsolidation')}
        </button>
        <button
          onClick={handleSweep}
          disabled={isSweeping}
          className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {isSweeping && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('triggerSweep')}
        </button>
      </section>

      {/* Consolidation History */}
      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('consolidationHistory')}
        </h2>
        {consolidationRuns.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No runs yet
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                    {t('runDate')}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                    Status
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                    {t('processed')}
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                    {t('merged')}
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                    {t('created')}
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                    {t('duration')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {consolidationRuns.map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-gray-100 dark:border-gray-800"
                  >
                    <td className="px-3 py-2 text-gray-900 dark:text-gray-100">
                      {new Date(run.runDate).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          run.status === 'completed'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                            : run.status === 'failed'
                              ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                              : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                      {run.entriesProcessed}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                      {run.entriesMerged}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                      {run.entriesCreated}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                      {run.durationMs
                        ? `${(run.durationMs / 1000).toFixed(1)}s`
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* RAG Test */}
      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('ragTest')}
        </h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={ragQuery}
            onChange={(e) => setRagQuery(e.target.value)}
            placeholder={t('testQuery')}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            onKeyDown={(e) => e.key === 'Enter' && handleRagTest()}
          />
          <button
            onClick={handleRagTest}
            disabled={isTestingRag || !ragQuery.trim()}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isTestingRag && <Loader2 className="h-4 w-4 animate-spin" />}
            Test
          </button>
        </div>
        {ragResult && (
          <pre className="mt-3 max-h-60 overflow-auto rounded-lg bg-gray-100 p-3 text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-300">
            {ragResult}
          </pre>
        )}
      </section>

      {/* Timeline */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
          Timeline
        </h2>
        <KnowledgeTimeline limit={20} />
      </section>
    </div>
  );
}
