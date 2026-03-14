'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  Play,
  Square,
  RotateCcw,
  Plus,
  Trash2,
  ArrowUpDown,
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  Pause,
  Loader2,
  Radio,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

interface QueueItemTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  workflowStatus: string | null;
  workflowMode: string | null;
  theme: { id: number; name: string; color: string } | null;
}

interface QueueItem {
  id: number;
  taskId: number;
  priority: number;
  status: string;
  currentPhase: string;
  dependencies: number[];
  retryCount: number;
  maxRetries: number;
  errorMessage: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  task: QueueItemTask | null;
}

interface OrchestraState {
  session: {
    id: number;
    status: string;
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    startedAt: string | null;
  } | null;
  runner: {
    isRunning: boolean;
    activeItems: number;
    processedTotal: number;
  };
  queue: {
    queued: number;
    running: number;
    waitingApproval: number;
    completed: number;
    failed: number;
  };
}

interface QueueState {
  queued: QueueItem[];
  running: QueueItem[];
  waitingApproval: QueueItem[];
  completed: QueueItem[];
  failed: QueueItem[];
  totalItems: number;
  maxConcurrency: number;
}

interface AvailableTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  workflowStatus: string | null;
  theme: { name: string } | null;
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    queued: {
      bg: 'bg-yellow-100 dark:bg-yellow-900/30',
      text: 'text-yellow-700 dark:text-yellow-300',
      label: 'キュー待ち',
    },
    running: {
      bg: 'bg-blue-100 dark:bg-blue-900/30',
      text: 'text-blue-700 dark:text-blue-300',
      label: '実行中',
    },
    waiting_approval: {
      bg: 'bg-orange-100 dark:bg-orange-900/30',
      text: 'text-orange-700 dark:text-orange-300',
      label: '承認待ち',
    },
    completed: {
      bg: 'bg-green-100 dark:bg-green-900/30',
      text: 'text-green-700 dark:text-green-300',
      label: '完了',
    },
    failed: {
      bg: 'bg-red-100 dark:bg-red-900/30',
      text: 'text-red-700 dark:text-red-300',
      label: '失敗',
    },
    cancelled: {
      bg: 'bg-gray-100 dark:bg-gray-800',
      text: 'text-gray-600 dark:text-gray-400',
      label: 'キャンセル',
    },
  };
  const c = config[status] || config.queued;
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}
    >
      {c.label}
    </span>
  );
}

function PhaseBadge({ phase }: { phase: string }) {
  const labels: Record<string, string> = {
    draft: '下書き',
    research_done: '調査完了',
    plan_created: '計画作成',
    plan_approved: '計画承認',
    in_progress: '実装中',
    verify_done: '検証完了',
    completed: '完了',
  };
  return (
    <span className="px-2 py-0.5 rounded text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
      {labels[phase] || phase}
    </span>
  );
}

export default function OrchestraPage() {
  const t = useTranslations('orchestra');
  const [state, setState] = useState<OrchestraState | null>(null);
  const [queueState, setQueueState] = useState<QueueState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [availableTasks, setAvailableTasks] = useState<AvailableTask[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    running: true,
    queued: true,
    waitingApproval: true,
    completed: false,
    failed: false,
  });
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const [stateRes, queueRes] = await Promise.all([
        fetch(`${API_BASE_URL}/workflow/orchestra/status`),
        fetch(`${API_BASE_URL}/workflow/orchestra/queue`),
      ]);
      if (stateRes.ok) setState(await stateRes.json());
      if (queueRes.ok) setQueueState(await queueRes.json());
    } catch (err) {
      console.error('Failed to fetch orchestra state:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();

    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const pollInterval: ReturnType<typeof setInterval> = setInterval(
      fetchState,
      10000,
    );

    const connectSSE = () => {
      const es = new EventSource(`${API_BASE_URL}/workflow/orchestra/events`);
      eventSourceRef.current = es;

      es.onopen = () => {
        reconnectAttempts = 0; // Reset on successful connection
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.state) {
            setState(data.state);
          }
          if (
            data.type === 'item_update' ||
            data.type?.startsWith('orchestra_')
          ) {
            fetchState();
          }
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        es.close();
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttempts - 1),
            10000,
          );
          reconnectTimer = setTimeout(() => {
            connectSSE();
          }, delay);
        }
      };
    };

    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      clearInterval(pollInterval);
    };
  }, [fetchState]);

  const startOrchestra = async () => {
    if (selectedTaskIds.length === 0) {
      setShowAddDialog(true);
      return;
    }
    setActionLoading('start');
    try {
      await fetch(`${API_BASE_URL}/workflow/orchestra/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds: selectedTaskIds, maxConcurrency: 3 }),
      });
      setSelectedTaskIds([]);
      setShowAddDialog(false);
      await fetchState();
    } finally {
      setActionLoading(null);
    }
  };

  const stopOrchestra = async () => {
    setActionLoading('stop');
    try {
      await fetch(`${API_BASE_URL}/workflow/orchestra/stop`, {
        method: 'POST',
      });
      await fetchState();
    } finally {
      setActionLoading(null);
    }
  };

  const resumeOrchestra = async () => {
    setActionLoading('resume');
    try {
      await fetch(`${API_BASE_URL}/workflow/orchestra/resume`, {
        method: 'POST',
      });
      await fetchState();
    } finally {
      setActionLoading(null);
    }
  };

  const enqueueTask = async (taskId: number) => {
    setActionLoading(`enqueue-${taskId}`);
    try {
      await fetch(`${API_BASE_URL}/workflow/orchestra/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      await fetchState();
    } finally {
      setActionLoading(null);
    }
  };

  const cancelItem = async (itemId: number) => {
    setActionLoading(`cancel-${itemId}`);
    try {
      await fetch(`${API_BASE_URL}/workflow/orchestra/queue/${itemId}`, {
        method: 'DELETE',
      });
      await fetchState();
    } finally {
      setActionLoading(null);
    }
  };

  const fetchAvailableTasks = async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/tasks?status=todo,in-progress&limit=50`,
      );
      if (res.ok) {
        const data = await res.json();
        setAvailableTasks(Array.isArray(data) ? data : data.tasks || []);
      }
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    }
  };

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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
                onClick={() => {
                  fetchAvailableTasks();
                  setShowAddDialog(true);
                }}
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
            onClick={() => {
              fetchAvailableTasks();
              setShowAddDialog(true);
            }}
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
                    width: `${Math.round(((state.session.completedTasks + state.session.failedTasks) / state.session.totalTasks) * 100)}%`,
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[70vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t('addTaskDialog.title')}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {t('addTaskDialog.description')}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1">
              {availableTasks.length === 0 ? (
                <p className="text-center text-gray-500 dark:text-gray-400 py-8">
                  {t('addTaskDialog.noTasks')}
                </p>
              ) : (
                availableTasks.map((task) => (
                  <label
                    key={task.id}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedTaskIds.includes(task.id)
                        ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800 border border-transparent'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTaskIds.includes(task.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedTaskIds((prev) => [...prev, task.id]);
                        } else {
                          setSelectedTaskIds((prev) =>
                            prev.filter((id) => id !== task.id),
                          );
                        }
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        #{task.id} {task.title}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {task.theme && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {task.theme.name}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          {task.priority} / {task.workflowStatus || 'draft'}
                        </span>
                      </div>
                    </div>
                  </label>
                ))
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {selectedTaskIds.length} {t('addTaskDialog.selected')}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setShowAddDialog(false);
                    setSelectedTaskIds([]);
                  }}
                  className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  {t('cancel')}
                </button>
                {isRunning ? (
                  <button
                    onClick={async () => {
                      for (const id of selectedTaskIds) {
                        await enqueueTask(id);
                      }
                      setShowAddDialog(false);
                      setSelectedTaskIds([]);
                    }}
                    disabled={
                      selectedTaskIds.length === 0 || actionLoading !== null
                    }
                    className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors"
                  >
                    {t('addTaskDialog.add')}
                  </button>
                ) : (
                  <button
                    onClick={startOrchestra}
                    disabled={
                      selectedTaskIds.length === 0 || actionLoading !== null
                    }
                    className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5" />
                    {t('addTaskDialog.startOrchestra')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    yellow:
      'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
    blue: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    orange:
      'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
    green:
      'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    red: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  };

  return (
    <div
      className={`rounded-xl border p-3 ${colorMap[color] || colorMap.blue}`}
    >
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {value}
      </div>
    </div>
  );
}

function QueueSection({
  title,
  items,
  expanded,
  onToggle,
  onCancel,
  actionLoading,
  icon,
}: {
  title: string;
  items: QueueItem[];
  expanded: boolean;
  onToggle: () => void;
  onCancel?: (itemId: number) => void;
  actionLoading: string | null;
  icon: React.ReactNode;
}) {
  if (items.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {title}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between px-4 py-3 border-b last:border-b-0 border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    #{item.taskId} {item.task?.title || 'Unknown task'}
                  </span>
                  <StatusBadge status={item.status} />
                  <PhaseBadge phase={item.currentPhase} />
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {item.task?.theme && (
                    <span
                      className="px-1.5 py-0.5 rounded text-xs"
                      style={{
                        backgroundColor: `${item.task.theme.color}20`,
                        color: item.task.theme.color,
                      }}
                    >
                      {item.task.theme.name}
                    </span>
                  )}
                  <span>Priority: {item.priority}</span>
                  {item.retryCount > 0 && (
                    <span>
                      Retry: {item.retryCount}/{item.maxRetries}
                    </span>
                  )}
                  {item.errorMessage && (
                    <span className="text-red-500 truncate max-w-xs">
                      {item.errorMessage}
                    </span>
                  )}
                </div>
              </div>
              {onCancel &&
                (item.status === 'queued' || item.status === 'running') && (
                  <button
                    onClick={() => onCancel(item.id)}
                    disabled={actionLoading === `cancel-${item.id}`}
                    className="ml-2 p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
