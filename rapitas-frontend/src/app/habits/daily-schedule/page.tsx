'use client';

/**
 * daily-schedule/page
 *
 * Top-level page component for the daily-schedule feature.
 * Composes useScheduleBlocks (data) with ScheduleChart, BlockList, and
 * BlockFormModal (UI). Not responsible for any direct API calls.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Plus, ArrowLeft, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useScheduleBlocks } from './_components/useScheduleBlocks';
import { ScheduleChart } from './_components/ScheduleChart';
import { BlockList } from './_components/BlockList';
import { BlockFormModal } from './_components/BlockFormModal';
import { timeToMinutes } from './_components/schedule-utils';

export default function DailySchedulePage() {
  const t = useTranslations('habits');
  const [hoveredBlock, setHoveredBlock] = useState<number | null>(null);

  const {
    blocks,
    loading,
    isModalOpen,
    editingBlock,
    formData,
    setFormData,
    openCreateModal,
    openEditModal,
    closeModal,
    handleSubmit,
    handleDelete,
    handleCategoryChange,
  } = useScheduleBlocks(t);

  // Compute summary stats for the chart header.
  const totalMinutes = blocks.reduce((sum, block) => {
    const start = timeToMinutes(block.startTime);
    let end = timeToMinutes(block.endTime);
    if (end <= start) end += 1440;
    return sum + Math.min(end - start, 1440);
  }, 0);

  const cappedTotal = Math.min(totalMinutes, 1440);
  const totalHours = Math.floor(cappedTotal / 60);
  const totalMins = cappedTotal % 60;
  const coveragePercent = Math.round((cappedTotal / 1440) * 100);

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/habits"
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          </Link>
          <Clock className="w-8 h-8 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {t('dailyScheduleTitle')}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('dailyScheduleSubtitle')}</p>
          </div>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span>{t('addBlock')}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ScheduleChart
          blocks={blocks}
          hoveredBlock={hoveredBlock}
          coveragePercent={coveragePercent}
          totalHours={totalHours}
          totalMins={totalMins}
          onBlockHover={setHoveredBlock}
          onBlockClick={openEditModal}
        />

        <BlockList
          blocks={blocks}
          hoveredBlock={hoveredBlock}
          onBlockHover={setHoveredBlock}
          onEdit={openEditModal}
          onDelete={handleDelete}
        />
      </div>

      <BlockFormModal
        isOpen={isModalOpen}
        editingBlock={editingBlock}
        formData={formData}
        onFormChange={setFormData}
        onCategoryChange={handleCategoryChange}
        onSubmit={handleSubmit}
        onClose={closeModal}
      />
    </div>
  );
}
