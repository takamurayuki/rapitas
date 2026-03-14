'use client';
import type { Priority } from '@/types';
import LabelSelector from '@/feature/tasks/components/LabelSelector';
import TaskStatusChange from '@/feature/tasks/components/TaskStatusChange';
import {
  statusConfig as sharedStatusConfig,
  renderStatusIcon,
} from '@/feature/tasks/config/StatusConfig';
import {
  Clock,
  FileText,
  Tag,
  ChevronDown,
  ChevronUp,
  ChevronsUp,
  ChevronsUpDown,
  Flag,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

interface TaskEditFormProps {
  editTitle: string;
  setEditTitle: (v: string) => void;
  editStatus: string;
  setEditStatus: (v: string) => void;
  editDescription: string;
  setEditDescription: (v: string) => void;
  editLabelIds: number[];
  setEditLabelIds: (v: number[]) => void;
  editPriority: Priority;
  setEditPriority: (v: Priority) => void;
  editEstimatedHours: string;
  setEditEstimatedHours: (v: string) => void;
}

const PRIORITY_OPTIONS: Array<{
  value: Priority;
  labelKey: string;
  icon: React.ReactNode;
  iconColor: string;
  bgColor: string;
}> = [
  {
    value: 'urgent',
    labelKey: 'priorityCritical',
    icon: <ChevronsUp className="w-3.5 h-3.5" />,
    iconColor: 'text-red-500',
    bgColor: 'bg-red-500',
  },
  {
    value: 'high',
    labelKey: 'priorityHigh',
    icon: <ChevronUp className="w-3.5 h-3.5" />,
    iconColor: 'text-orange-500',
    bgColor: 'bg-orange-500',
  },
  {
    value: 'medium',
    labelKey: 'priorityMedium',
    icon: <ChevronsUpDown className="w-3.5 h-3.5" />,
    iconColor: 'text-blue-500',
    bgColor: 'bg-blue-500',
  },
  {
    value: 'low',
    labelKey: 'priorityLow',
    icon: <ChevronDown className="w-3.5 h-3.5" />,
    iconColor: 'text-zinc-400',
    bgColor: 'bg-zinc-500',
  },
];

export default function TaskEditForm({
  editTitle,
  setEditTitle,
  editStatus,
  setEditStatus,
  editDescription,
  setEditDescription,
  editLabelIds,
  setEditLabelIds,
  editPriority,
  setEditPriority,
  editEstimatedHours,
  setEditEstimatedHours,
}: TaskEditFormProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');
  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden">
      {/* Title Input with Status */}
      <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <input
            type="text"
            className="flex-1 min-w-0 text-2xl font-bold bg-transparent border-none outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder={t('taskNamePlaceholder')}
          />
          <div className="flex items-center gap-1 shrink-0">
            {(['todo', 'in-progress', 'done'] as const).map((status) => {
              const config = sharedStatusConfig[status];
              return (
                <TaskStatusChange
                  key={status}
                  status={status}
                  currentStatus={editStatus}
                  config={config}
                  renderIcon={renderStatusIcon}
                  onClick={(newStatus: string) => setEditStatus(newStatus)}
                  size="md"
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-3">
          <FileText className="w-4 h-4" />
          <span className="text-sm font-medium">{t('description')}</span>
        </div>
        <textarea
          className="w-full bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-4 py-3 text-sm border-none outline-none resize-none focus:ring-2 focus:ring-violet-500/20 transition-all font-mono min-h-[200px]"
          value={editDescription}
          onChange={(e) => setEditDescription(e.target.value)}
          placeholder={t('markdownPlaceholder')}
        />
      </div>

      {/* Labels */}
      <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-3">
          <Tag className="w-4 h-4" />
          <span className="text-sm font-medium">{t('labels')}</span>
        </div>
        <LabelSelector
          selectedLabelIds={editLabelIds}
          onChange={setEditLabelIds}
        />
      </div>

      {/* Priority */}
      <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-3">
          <Flag className="w-4 h-4" />
          <span className="text-sm font-medium">{t('priority')}</span>
        </div>
        <div className="flex items-center gap-1">
          {PRIORITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setEditPriority(opt.value)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                editPriority === opt.value
                  ? `${opt.bgColor} text-white shadow-md`
                  : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700'
              }`}
            >
              <span
                className={
                  editPriority === opt.value ? 'text-white' : opt.iconColor
                }
              >
                {opt.icon}
              </span>
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Estimated Hours */}
      <div className="p-6">
        <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-3">
          <Clock className="w-4 h-4" />
          <span className="text-sm font-medium">{t('estimatedTime')}</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.5"
            min="0"
            className="w-32 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-4 py-2.5 text-sm border-none outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
            placeholder="0"
            value={editEstimatedHours}
            onChange={(e) => setEditEstimatedHours(e.target.value)}
          />
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {tc('hours')}
          </span>
        </div>
      </div>
    </div>
  );
}
