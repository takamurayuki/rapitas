/**
 * OrchestraPage
 *
 * Page component for the Orchestra multi-task runner. Composes the
 * useOrchestraState hook with presentational sub-components: StatCard,
 * QueueSection, AddTaskDialog, and OrchestraBadges.
 */
'use client';

import { useTranslations } from 'next-intl';
import {
  Play,
  Square,
  RotateCcw,
  Plus,
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  Pause,
  Loader2,
  Radio,
} from 'lucide-react';
import { useOrchestraState } from './useOrchestraState';
import { StatCard } from './components/StatCard';
import { QueueSection } from './components/QueueSection';
import { AddTaskDialog } from './components/AddTaskDialog';
import { StatusBadge } from './components/OrchestraBadges';

export default function OrchestraPage() {
  const t = useTranslations('orchestra');
  const {
    state,
    queueState,
    loading,
    actionLoading,
    showAddDialog,
    availableTasks,
    selectedTaskIds,
    expandedSections,
    startOrchestra,
    stopOrchestra,
    resumeOrchestra,
    cancelItem,
    toggleSection,
    handleSelectTask,
    handleEnqueueSelected,
    openAddDialog,
    closeAddDialog,
  } = useOrchestraState();

  const isRunning = state?.runner?.isRunning || false;
  const sessionStatus = state?.session?.status || 'idle';

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Activity className="w-6 h-6 text-indigo-500" />
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('description')}
          </p>
        </div>

        {/* Control buttons */}
        <div className="flex items-center gap-2">
          {!isRunning ? (
            <>
              <button
                onClick={openAddDialog}
                disabled={actionLoading !== null}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                <Play className="w-4 h-4" />
                {t('start')}
              </button>
              {sessionStatus === 'paused' && (
                <button
                  onClick={resumeOrchestra}
                  disabled={actionLoading !== null}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  {t('resume')}
                </button>
              )}
            </>
          ) : (
            <button
              onClick={stopOrchestra}
              disabled={actionLoading !== null}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
            >
              <Square className="w-4 h-4" />
              {t('stop')}
            </button>
          )}
          <button
            onClick={openAddDialog}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t('addTask')}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          icon={<Clock className="w-4 h-4" />}
          label={t('stats.queued')}
          value={state?.queue?.queued || 0}
          color="yellow"
        />
        <StatCard
          icon={
            <Loader2 className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
          }
          label={t('stats.running')}
          value={state?.queue?.running || 0}
          color="blue"
        />
        <StatCard
          icon={<Pause className="w-4 h-4" />}
          label={t('stats.waitingApproval')}
          value={state?.queue?.waitingApproval || 0}
          color="orange"
        />
        <StatCard
          icon={<CheckCircle2 className="w-4 h-4" />}
          label={t('stats.completed')}
          value={state?.queue?.completed || 0}
          color="green"
        />
        <StatCard
          icon={<XCircle className="w-4 h-4" />}
          label={t('stats.failed')}
          value={state?.queue?.failed || 0}
          color="red"
        />
      </div>

      {/* Runner Status */}
      {state?.session && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}
              />
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {t('session')} #{state.session.id}
              </span>
              <StatusBadge status={state.session.status} />
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {t('processed')}: {state.runner.processedTotal} | {t('active')}:{' '}
              {state.runner.activeItems}
            </div>
          </div>
          {state.session.totalTasks > 0 && (
            <div className="mt-3">
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.round(
                      ((state.session.completedTasks +
                        state.session.failedTasks) /
                        state.session.totalTasks) *
                        100,
                    )}%`,
                  }}
                />
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span>
                  {state.session.completedTasks + state.session.failedTasks} /{' '}
                  {state.session.totalTasks}
                </span>
                <span>
                  {Math.round(
                    ((state.session.completedTasks +
                      state.session.failedTasks) /
                      state.session.totalTasks) *
                      100,
                  )}
                  %
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Queue Sections */}
      {queueState && (
        <div className="space-y-3">
          <QueueSection
            title={`${t('sections.running')} (${queueState.running.length})`}
            items={queueState.running}
            expanded={expandedSections.running}
            onToggle={() => toggleSection('running')}
            onCancel={cancelItem}
            actionLoading={actionLoading}
            icon={<Radio className="w-4 h-4 text-blue-500" />}
          />
          <QueueSection
            title={`${t('sections.queued')} (${queueState.queued.length})`}
            items={queueState.queued}
            expanded={expandedSections.queued}
            onToggle={() => toggleSection('queued')}
            onCancel={cancelItem}
            actionLoading={actionLoading}
            icon={<Clock className="w-4 h-4 text-yellow-500" />}
          />
          <QueueSection
            title={`${t('sections.waitingApproval')} (${queueState.waitingApproval.length})`}
            items={queueState.waitingApproval}
            expanded={expandedSections.waitingApproval}
            onToggle={() => toggleSection('waitingApproval')}
            onCancel={cancelItem}
            actionLoading={actionLoading}
            icon={<Pause className="w-4 h-4 text-orange-500" />}
          />
          <QueueSection
            title={`${t('sections.completed')} (${queueState.completed.length})`}
            items={queueState.completed}
            expanded={expandedSections.completed}
            onToggle={() => toggleSection('completed')}
            actionLoading={actionLoading}
            icon={<CheckCircle2 className="w-4 h-4 text-green-500" />}
          />
          <QueueSection
            title={`${t('sections.failed')} (${queueState.failed.length})`}
            items={queueState.failed}
            expanded={expandedSections.failed}
            onToggle={() => toggleSection('failed')}
            actionLoading={actionLoading}
            icon={<XCircle className="w-4 h-4 text-red-500" />}
          />
        </div>
      )}

      {/* Add Tasks Dialog */}
      {showAddDialog && (
        <AddTaskDialog
          availableTasks={availableTasks}
          selectedTaskIds={selectedTaskIds}
          isRunning={isRunning}
          actionLoading={actionLoading}
          onSelectTask={handleSelectTask}
          onCancel={closeAddDialog}
          onEnqueueSelected={handleEnqueueSelected}
          onStartOrchestra={startOrchestra}
          t={t}
        />
      )}
    </div>
  );
}
