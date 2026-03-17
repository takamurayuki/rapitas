'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Clock,
  Tag,
  Layers,
  Flag,
  FileText,
  Plus,
  Trash2,
  Calendar,
  SwatchBook,
  CheckCircle2,
  Settings2,
  FileStack,
  Sparkles,
  Loader2,
  ChevronsUp,
  ChevronUp,
  ChevronsUpDown,
  ChevronDown,
  Check,
  X,
} from 'lucide-react';
import type {
  Priority,
  Theme,
  TaskTemplate,
  UserSettings,
  Category,
  WorkflowMode,
} from '@/types';
import LabelSelector from '@/feature/tasks/components/LabelSelector';
import TaskTitleAutocomplete from '@/feature/tasks/components/TaskTitleAutocomplete';
import { getIconComponent } from '@/components/category/IconData';
import {
  CompactAccordionGroup,
  InlineFieldGroup,
  FieldItem,
} from '@/components/ui/accordion';
import ApplyTemplateDialog from '@/feature/tasks/components/dialog/ApplyTemplateDialog';
import TaskSuggestions from '@/feature/tasks/components/TaskSuggestions';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { API_BASE_URL } from '@/utils/api';
import { getTaskDetailPath } from '@/utils/tauri';
import { useAppModeStore } from '@/stores/appModeStore';
import { requireAuth } from '@/contexts/AuthContext';
import CompactWorkflowSelector from '@/components/workflow/CompactWorkflowSelector';
import { RelatedKnowledgePanel } from '@/feature/intelligence/components/RelatedKnowledgePanel';
import { createLogger } from '@/lib/logger';
import { useTranslations } from 'next-intl';
import { useLocaleStore } from '@/stores/localeStore';
import { toDateLocale } from '@/lib/utils';
import {
  statusConfig,
  renderStatusIcon,
} from '@/feature/tasks/config/StatusConfig';

const logger = createLogger('NewTaskClient');
const API_BASE = API_BASE_URL;

function NewTaskClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const appMode = useAppModeStore((state) => state.mode);
  const t = useTranslations('task');
  const tc = useTranslations('common');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [themeId, setThemeId] = useState<number | null>(null);

  const [labels] = useState('');
  const [selectedLabelIds, setSelectedLabelIds] = useState<number[]>([]);
  const [estimatedHours, setEstimatedHours] = useState('');
  const [dueDate, setDueDate] = useState('');

  const [workflowMode, setWorkflowMode] =
    useState<WorkflowMode>('comprehensive');
  const [isWorkflowModeOverride, setIsWorkflowModeOverride] =
    useState<boolean>(false);

  const [themes, setThemes] = useState<Theme[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [appliedTemplate, setAppliedTemplate] = useState<TaskTemplate | null>(
    null,
  );
  const [globalSettings, setGlobalSettings] = useState<UserSettings | null>(
    null,
  );

  const [subtasks, setSubtasks] = useState<
    {
      id: string;
      title: string;
      description?: string;
      priority?: Priority;
      labels?: string[];
      estimatedHours?: number;
    }[]
  >([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [newSubtaskDescription, setNewSubtaskDescription] = useState('');
  const [newSubtaskPriority, setNewSubtaskPriority] =
    useState<Priority>('medium');
  const [newSubtaskLabels, setNewSubtaskLabels] = useState('');
  const [newSubtaskEstimatedHours, setNewSubtaskEstimatedHours] = useState('');

  const fetchCategories = async () => {
    try {
      const res = await fetch(`${API_BASE}/categories`);
      if (res.ok) {
        setCategories(await res.json());
      }
    } catch (e) {
      logger.error('Failed to fetch categories:', e);
    }
  };

  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const themeIdParam = searchParams.get('themeId');
    if (themeIdParam) {
      setThemeId(Number(themeIdParam));
    }
    fetchThemes();
    fetchCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const fetchGlobalSettings = async () => {
      try {
        const res = await fetch(`${API_BASE}/settings`);
        if (res.ok) {
          const settings = await res.json();
          logger.debug('[NewTaskClient] Fetched settings:', settings);
          setGlobalSettings(settings);
        }
      } catch (e) {
        logger.error('Failed to fetch global settings:', e);
      }
    };
    fetchGlobalSettings();
  }, []);

  const fetchThemes = async () => {
    try {
      const res = await fetch(`${API_BASE}/themes`);
      const data = await res.json();
      setThemes(data);
      const themeIdParam = searchParams.get('themeId');
      if (!themeIdParam) {
        const defaultTheme = data.find((t: Theme) => t.isDefault);
        if (defaultTheme) {
          setThemeId(defaultTheme.id);
        }
      }
    } catch (e) {
      logger.error(e);
    }
  };

  const handleThemeSelect = (theme: Theme) => {
    setThemeId(theme.id);
  };

  const selectedTheme = useMemo(() => {
    return themes.find((t) => t.id === themeId) || null;
  }, [themes, themeId]);

  const handleApplyTemplate = (template: TaskTemplate) => {
    setAppliedTemplate(template);

    // Apply template data
    const data = template.templateData;

    if (data.title) {
      setTitle(data.title);
    }
    if (data.description) {
      setDescription(data.description);
    }
    if (data.priority) {
      setPriority(data.priority);
    }
    if (data.estimatedHours) {
      setEstimatedHours(data.estimatedHours.toString());
    }

    // Apply subtasks from template
    if (data.subtasks && Array.isArray(data.subtasks)) {
      setSubtasks(
        data.subtasks.map((st, idx) => ({
          id: `template-${idx}-${Date.now()}`,
          title: st.title,
          description: st.description,
          estimatedHours: st.estimatedHours,
        })),
      );
    }
  };

  const resetSubtaskForm = () => {
    setNewSubtaskTitle('');
    setNewSubtaskDescription('');
    setNewSubtaskPriority('medium');
    setNewSubtaskLabels('');
    setNewSubtaskEstimatedHours('');
  };

  const addSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    const labelsArray = newSubtaskLabels
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);
    const hours = parseFloat(newSubtaskEstimatedHours);
    setSubtasks([
      ...subtasks,
      {
        id: Date.now().toString(),
        title: newSubtaskTitle.trim(),
        ...(newSubtaskDescription.trim() && {
          description: newSubtaskDescription.trim(),
        }),
        priority: newSubtaskPriority,
        ...(labelsArray.length > 0 && { labels: labelsArray }),
        ...(hours && !isNaN(hours) && { estimatedHours: hours }),
      },
    ]);
    resetSubtaskForm();
  };

  const removeSubtask = (id: string) => {
    setSubtasks(subtasks.filter((st) => st.id !== id));
  };

  const handleGenerateTitle = async (fromAutoGenerate = false) => {
    if (!description.trim() || isGeneratingTitle) return;

    setIsGeneratingTitle(true);
    try {
      const res = await fetch(`${API_BASE}/developer-mode/generate-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim() }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || t('titleGenerateFailed'));
      }

      const data = await res.json();
      if (data.title) {
        setTitle(data.title);
        if (!fromAutoGenerate) {
          showToast(t('titleGeneratedSuccess'), 'success');
        }

        // NOTE: Auto-create after title generation (only when called from auto-generate).
        if (
          fromAutoGenerate &&
          globalSettings?.autoCreateAfterTitleGeneration
        ) {
          logger.debug(
            '[NewTaskClient] Auto-creating task with title:',
            data.title,
          );
          setTimeout(() => {
            handleSubmitWithTitle(data.title);
          }, 100); // NOTE: Short delay to ensure state update completes before submission.
        }
      }
    } catch (e) {
      logger.error(e);
      showToast(
        e instanceof Error ? e.message : t('titleGenerateFailed'),
        'error',
      );
    } finally {
      setIsGeneratingTitle(false);
    }
  };

  const autoGenerateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    if (autoGenerateTimerRef.current) {
      clearTimeout(autoGenerateTimerRef.current);
      autoGenerateTimerRef.current = null;
    }

    // Only trigger when auto-generate is ON, description exists, and title is empty
    if (
      !globalSettings?.autoGenerateTitle ||
      !description.trim() ||
      title.trim() ||
      isGeneratingTitle
    ) {
      return;
    }

    const delaySec = globalSettings?.autoGenerateTitleDelay ?? 3;
    logger.debug(
      '[NewTaskClient] Setting auto-generate timer for',
      delaySec,
      'seconds',
    );
    autoGenerateTimerRef.current = setTimeout(() => {
      logger.debug(
        '[NewTaskClient] Auto-generate timer triggered, calling handleGenerateTitle',
      );
      handleGenerateTitle(true);
    }, delaySec * 1000);

    return () => {
      if (autoGenerateTimerRef.current) {
        clearTimeout(autoGenerateTimerRef.current);
        autoGenerateTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    description,
    globalSettings?.autoGenerateTitle,
    globalSettings?.autoGenerateTitleDelay,
  ]);

  const handleSubmitWithTitle = async (generatedTitle: string) => {
    logger.debug(
      '[NewTaskClient] handleSubmitWithTitle called with:',
      generatedTitle,
    );
    if (isSubmitting || !generatedTitle.trim()) {
      logger.debug(
        '[NewTaskClient] Aborting submission - isSubmitting:',
        isSubmitting,
        'title empty:',
        !generatedTitle.trim(),
      );
      return;
    }

    // Only allow auto-execute for tasks in development project themes
    const executeAfterCreate =
      (globalSettings?.autoExecuteAfterCreate ?? false) &&
      selectedTheme?.isDevelopment === true;

    setIsSubmitting(true);
    try {
      const labelArray = labels
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);

      const taskData = {
        title: generatedTitle,
        description: description || undefined,
        status: 'todo',
        priority,
        themeId: themeId || undefined,
        labels: labelArray.length > 0 ? labelArray : undefined,
        labelIds: selectedLabelIds.length > 0 ? selectedLabelIds : undefined,
        estimatedHours: estimatedHours ? parseFloat(estimatedHours) : undefined,
        dueDate: dueDate || undefined,
        workflowMode: workflowMode,
        workflowModeOverride: isWorkflowModeOverride,
      };

      logger.debug('[NewTaskClient] Creating task with data:', taskData);

      const res = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskData),
      });

      if (!res.ok) throw new Error(t('createFailed'));
      const createdTask = await res.json();

      // Create subtasks
      if (subtasks.length > 0) {
        const subtaskResults = await Promise.allSettled(
          subtasks
            .filter((st) => st.title.trim())
            .map(async (st) => {
              const subtaskRes = await fetch(`${API_BASE}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  title: st.title,
                  ...(st.description && { description: st.description }),
                  status: 'todo',
                  priority: st.priority || 'medium',
                  ...(st.labels &&
                    st.labels.length > 0 && {
                      labels: JSON.stringify(st.labels),
                    }),
                  ...(st.estimatedHours && {
                    estimatedHours: st.estimatedHours,
                  }),
                  parentId: createdTask.id,
                }),
              });
              if (!subtaskRes.ok) {
                const errorText = await subtaskRes.text();
                logger.error(
                  `[NewTaskClient] Failed to create subtask "${st.title}":`,
                  errorText,
                );
              }
              return subtaskRes;
            }),
        );

        const failedCount = subtaskResults.filter(
          (r) => r.status === 'rejected',
        ).length;
        if (failedCount > 0) {
          logger.warn(
            `[NewTaskClient] ${failedCount} subtask(s) failed to create`,
          );
        }
      }

      if (executeAfterCreate) {
        showToast(t('taskCreatedAutoExecute'), 'success');
        const detailPath = getTaskDetailPath(createdTask.id);
        const separator = detailPath.includes('?') ? '&' : '?';
        router.push(
          `${detailPath}${separator}autoExecute=true&showHeader=true`,
        );
      } else {
        showToast(t('taskCreated'), 'success');
        router.push('/');
      }
    } catch (e) {
      logger.error(e);
      showToast(t('taskCreateFailed'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSubmitting || !title.trim()) return;

    // Only allow auto-execute for tasks in development project themes
    const executeAfterCreate =
      (globalSettings?.autoExecuteAfterCreate ?? false) &&
      selectedTheme?.isDevelopment === true;

    setIsSubmitting(true);
    try {
      const labelArray = labels
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);

      const res = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: description || undefined,
          status: 'todo',
          priority,
          themeId: themeId || undefined,
          labels: labelArray.length > 0 ? labelArray : undefined,
          labelIds: selectedLabelIds.length > 0 ? selectedLabelIds : undefined,
          estimatedHours: estimatedHours
            ? parseFloat(estimatedHours)
            : undefined,
          dueDate: dueDate || undefined,
          workflowMode: workflowMode,
          workflowModeOverride: isWorkflowModeOverride,
        }),
      });

      if (!res.ok) throw new Error(t('createFailed'));
      const createdTask = await res.json();

      // Create subtasks
      if (subtasks.length > 0) {
        const subtaskResults = await Promise.allSettled(
          subtasks
            .filter((st) => st.title.trim())
            .map(async (st) => {
              const subtaskRes = await fetch(`${API_BASE}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  title: st.title,
                  ...(st.description && { description: st.description }),
                  status: 'todo',
                  priority: st.priority || 'medium',
                  ...(st.labels &&
                    st.labels.length > 0 && {
                      labels: JSON.stringify(st.labels),
                    }),
                  ...(st.estimatedHours && {
                    estimatedHours: st.estimatedHours,
                  }),
                  parentId: createdTask.id,
                }),
              });
              if (!subtaskRes.ok) {
                const errorText = await subtaskRes.text();
                logger.error(
                  `[NewTaskClient] Failed to create subtask "${st.title}":`,
                  errorText,
                );
              }
              return subtaskRes;
            }),
        );

        const failedCount = subtaskResults.filter(
          (r) => r.status === 'rejected',
        ).length;
        if (failedCount > 0) {
          logger.warn(
            `[NewTaskClient] ${failedCount} subtask(s) failed to create`,
          );
        }
      }

      if (executeAfterCreate) {
        showToast(t('taskCreatedAutoExecute'), 'success');
        const detailPath = getTaskDetailPath(createdTask.id);
        const separator = detailPath.includes('?') ? '&' : '?';
        router.push(
          `${detailPath}${separator}autoExecute=true&showHeader=true`,
        );
      } else {
        showToast(t('taskCreated'), 'success');
        router.push('/');
      }
    } catch (e) {
      logger.error(e);
      showToast(t('taskCreateFailed'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApplySuggestion = (suggestion: {
    title: string;
    priority: Priority;
    estimatedHours: string;
    description: string;
    labelIds: number[];
  }) => {
    setTitle(suggestion.title);
    setPriority(suggestion.priority);
    if (suggestion.estimatedHours) {
      setEstimatedHours(suggestion.estimatedHours);
    }
    if (suggestion.description) {
      setDescription(suggestion.description);
    }
    if (suggestion.labelIds.length > 0) {
      setSelectedLabelIds(suggestion.labelIds);
    }
    showToast(t('suggestionApplied'), 'success');
  };

  const priorityOptions = [
    {
      value: 'urgent' as Priority,
      label: t('priorityCritical'),
      icon: <ChevronsUp className="w-3.5 h-3.5" />,
      iconColor: 'text-red-500',
      bgColor: 'bg-red-500',
    },
    {
      value: 'high' as Priority,
      label: t('priorityHigh'),
      icon: <ChevronUp className="w-3.5 h-3.5" />,
      iconColor: 'text-orange-500',
      bgColor: 'bg-orange-500',
    },
    {
      value: 'medium' as Priority,
      label: t('priorityMedium'),
      icon: <ChevronsUpDown className="w-3.5 h-3.5" />,
      iconColor: 'text-blue-500',
      bgColor: 'bg-blue-500',
    },
    {
      value: 'low' as Priority,
      label: t('priorityLow'),
      icon: <ChevronDown className="w-3.5 h-3.5" />,
      iconColor: 'text-zinc-400',
      bgColor: 'bg-zinc-500',
    },
  ];

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-background scrollbar-thin">
      <div className="max-w-2xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm font-medium">{tc('back')}</span>
          </button>
          <div className="flex items-center gap-2">
            <div
              className={`relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 ${
                appliedTemplate
                  ? 'border-purple-500 dark:border-purple-400'
                  : 'hover:border-purple-500 dark:hover:border-purple-400'
              }`}
            >
              <button
                type="button"
                onClick={() => setShowTemplateDialog(true)}
                className={`flex items-center gap-2 transition-all cursor-pointer ${
                  appliedTemplate
                    ? 'text-purple-700 dark:text-purple-300'
                    : 'text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300'
                }`}
              >
                <FileStack className="w-4 h-4" />
                <span className="font-mono text-xs font-black tracking-tight">
                  {appliedTemplate ? appliedTemplate.name : t('template')}
                </span>
              </button>
            </div>
            <div
              className={`relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 ${!title.trim() || isSubmitting ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-500 dark:hover:border-blue-400'}`}
            >
              <button
                onClick={(e) => handleSubmit(e)}
                disabled={!title.trim() || isSubmitting}
                className={`flex items-center gap-2 transition-all ${!title.trim() || isSubmitting ? 'cursor-not-allowed text-gray-400 dark:text-gray-600' : 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer'}`}
              >
                {isSubmitting ? (
                  <div className="w-4 h-4 border-2 border-slate-300 dark:border-slate-600 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                <span className="font-mono text-xs font-black tracking-tight">
                  {tc('create')}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <form
        onSubmit={(e) => handleSubmit(e)}
        className="max-w-2xl mx-auto px-4 pb-8"
      >
        <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl shadow-zinc-200/50 dark:shadow-none border border-zinc-200/50 dark:border-zinc-800 overflow-hidden">
          <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
            <TaskTitleAutocomplete
              value={title}
              onChange={setTitle}
              placeholder={t('taskNamePlaceholder')}
              autoFocus
              themeId={themeId}
            />
          </div>

          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
            <InlineFieldGroup>
              <FieldItem
                label={t('priority')}
                icon={<Flag className="w-3.5 h-3.5" />}
                className="flex-1"
              >
                <div className="flex items-center gap-1">
                  {priorityOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPriority(opt.value)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                        priority === opt.value
                          ? `${opt.bgColor} text-white shadow-md`
                          : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700'
                      }`}
                    >
                      <span
                        className={
                          priority === opt.value ? 'text-white' : opt.iconColor
                        }
                      >
                        {opt.icon}
                      </span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </FieldItem>

              <FieldItem
                label={t('theme')}
                icon={<Layers className="w-3.5 h-3.5" />}
                className="flex-1"
              >
                <div className="flex flex-wrap gap-1.5">
                  {(() => {
                    const themeIdParam = searchParams.get('themeId');
                    // Build category ID set based on appMode filter
                    const visibleCategoryIds = new Set(
                      categories
                        .filter((cat) => {
                          if (appMode === 'all') return true;
                          if (cat.mode === 'both') return true;
                          return cat.mode === appMode;
                        })
                        .map((cat) => cat.id),
                    );
                    const displayThemes = themeIdParam
                      ? themes.filter((t) => t.id === Number(themeIdParam))
                      : themes.filter((t) => {
                          // Always show themes without a category regardless of appMode
                          if (!t.categoryId) return true;
                          return visibleCategoryIds.has(t.categoryId);
                        });
                    return displayThemes.map((theme) => {
                      const ThemeIcon =
                        getIconComponent(theme.icon || '') || SwatchBook;
                      return (
                        <button
                          key={theme.id}
                          type="button"
                          onClick={() => handleThemeSelect(theme)}
                          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
                            themeId === theme.id
                              ? 'ring-1 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900'
                              : 'opacity-60 hover:opacity-100'
                          }`}
                          style={
                            {
                              backgroundColor:
                                themeId === theme.id
                                  ? theme.color
                                  : `${theme.color}20`,
                              color:
                                themeId === theme.id ? '#fff' : theme.color,
                              ['--tw-ring-color' as keyof React.CSSProperties]:
                                theme.color,
                            } as React.CSSProperties
                          }
                        >
                          <ThemeIcon className="w-2.5 h-2.5" />
                          {theme.name}
                        </button>
                      );
                    });
                  })()}
                </div>
              </FieldItem>
            </InlineFieldGroup>
          </div>

          <TaskSuggestions themeId={themeId} onApply={handleApplySuggestion} />

          <CompactAccordionGroup
            title={t('description')}
            icon={<FileText className="w-3.5 h-3.5" />}
            defaultExpanded={true}
            headerExtra={
              <button
                type="button"
                onClick={() => handleGenerateTitle(false)}
                disabled={!description.trim() || isGeneratingTitle}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400 hover:bg-violet-200 dark:hover:bg-violet-900 disabled:opacity-40 disabled:cursor-not-allowed"
                title={t('titleGenerateTooltip')}
              >
                {isGeneratingTitle ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                <span>{t('titleGenerate')}</span>
              </button>
            }
          >
            <textarea
              ref={(el) => {
                if (el) {
                  el.style.height = 'auto';
                  el.style.height = `${Math.max(el.scrollHeight, 84)}px`;
                }
              }}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = `${Math.max(el.scrollHeight, 84)}px`;
              }}
              placeholder={t('taskDetailPlaceholder')}
              className="w-full min-h-[84px] bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-4 py-3 text-sm border-none outline-none resize-none focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            />
          </CompactAccordionGroup>

          {title.length >= 3 && (
            <RelatedKnowledgePanel
              title={title}
              description={description || null}
              themeId={themeId}
            />
          )}

          <CompactAccordionGroup
            title={t('advancedSettings')}
            icon={<Settings2 className="w-3.5 h-3.5" />}
            defaultExpanded={false}
          >
            <div className="space-y-4">
              <InlineFieldGroup>
                <FieldItem
                  label={t('deadlineDate')}
                  icon={<Calendar className="w-3.5 h-3.5" />}
                  className="flex-1 min-w-[200px]"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="datetime-local"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="flex-1 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2 text-sm border-none outline-none focus:ring-2 focus:ring-blue-500/20 transition-all dark:scheme:dark"
                    />
                    {dueDate && (
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 shrink-0">
                        (
                        {new Date(dueDate).toLocaleDateString(dateLocale, {
                          weekday: 'short',
                        })}
                        )
                      </span>
                    )}
                  </div>
                </FieldItem>
                <FieldItem
                  label={t('estimatedTime')}
                  icon={<Clock className="w-3.5 h-3.5" />}
                  className="flex-1 min-w-[100px]"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={estimatedHours}
                      onChange={(e) => setEstimatedHours(e.target.value)}
                      placeholder="0"
                      className="w-16 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2 text-sm border-none outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                    />
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {tc('hours')}
                    </span>
                  </div>
                </FieldItem>
              </InlineFieldGroup>

              <FieldItem
                label={t('labels')}
                icon={<Tag className="w-3.5 h-3.5" />}
                fullWidth
              >
                <LabelSelector
                  selectedLabelIds={selectedLabelIds}
                  onChange={setSelectedLabelIds}
                />
              </FieldItem>
            </div>
          </CompactAccordionGroup>

          <CompactAccordionGroup
            title={t('subtasks')}
            icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
            badge={
              <span className="px-2 py-0.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 rounded-full">
                {subtasks.length}
              </span>
            }
            defaultExpanded
            className="border-b-0"
          >
            <div className="mb-3 p-4 rounded-lg bg-emerald-50/30 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/30">
              <div className="space-y-4">
                <div>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400"
                    value={newSubtaskTitle}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newSubtaskTitle.trim()) {
                        e.preventDefault();
                        addSubtask();
                      } else if (e.key === 'Escape') {
                        resetSubtaskForm();
                      }
                    }}
                    placeholder={t('addSubtaskPlaceholder')}
                  />
                </div>

                <div>
                  <textarea
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400"
                    value={newSubtaskDescription}
                    onChange={(e) => setNewSubtaskDescription(e.target.value)}
                    placeholder={t('subtaskDescriptionPlaceholder')}
                    rows={3}
                  />
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                    <Flag className="w-3.5 h-3.5" />
                    {t('subtaskPriority')}
                  </label>
                  <div className="flex items-center gap-1">
                    {priorityOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setNewSubtaskPriority(opt.value)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                          newSubtaskPriority === opt.value
                            ? `${opt.bgColor} text-white shadow-md`
                            : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700'
                        }`}
                      >
                        <span
                          className={
                            newSubtaskPriority === opt.value
                              ? 'text-white'
                              : opt.iconColor
                          }
                        >
                          {opt.icon}
                        </span>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="w-full sm:w-36">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      {t('subtaskEstimatedHours')}
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400"
                      placeholder="0"
                      value={newSubtaskEstimatedHours}
                      onChange={(e) =>
                        setNewSubtaskEstimatedHours(e.target.value)
                      }
                    />
                  </div>

                  <div className="flex-1">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                      <Tag className="w-3.5 h-3.5" />
                      {t('subtaskLabels')}
                    </label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400"
                      placeholder={t('labelsCommaSeparated')}
                      value={newSubtaskLabels}
                      onChange={(e) => setNewSubtaskLabels(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <div
                    className={`relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 ${!newSubtaskTitle.trim() ? 'opacity-50 cursor-not-allowed' : 'hover:border-emerald-500 dark:hover:border-emerald-400'}`}
                  >
                    <button
                      type="button"
                      onClick={addSubtask}
                      disabled={!newSubtaskTitle.trim()}
                      className={`flex items-center gap-2 transition-all ${!newSubtaskTitle.trim() ? 'cursor-not-allowed text-gray-400 dark:text-gray-600' : 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 cursor-pointer'}`}
                    >
                      <Check className="w-4 h-4" />
                      <span className="font-mono text-xs font-black tracking-tight">
                        {tc('save')}
                      </span>
                    </button>
                  </div>
                  <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-gray-500 dark:hover:border-gray-400">
                    <button
                      type="button"
                      onClick={resetSubtaskForm}
                      className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      <span className="font-mono text-xs font-black tracking-tight">
                        {tc('cancel')}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {subtasks.length > 0 && (
              <div className="bg-zinc-50/50 dark:bg-indigo-dark-900/50 rounded-lg overflow-hidden">
                {subtasks.map((st, index) => {
                  // Use todo status config for new subtasks (can be extended later)
                  const subtaskStatus = statusConfig.todo;
                  const isFirst = index === 0;
                  const isLast = index === subtasks.length - 1;
                  const roundedClass =
                    isFirst && isLast
                      ? 'rounded-md'
                      : isFirst
                        ? 'rounded-t-md'
                        : isLast
                          ? 'rounded-b-md'
                          : '';
                  return (
                    <div
                      key={st.id}
                      className={`group p-2 ${roundedClass} transition-colors border-l-2 ${subtaskStatus.borderColor} ${subtaskStatus.bgColor} dark:bg-indigo-dark-900`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`flex items-center justify-center w-6 h-6 rounded ${subtaskStatus.color} ${subtaskStatus.bgColor} border ${subtaskStatus.borderColor.replace('border-l-', 'border-')} shrink-0`}
                          aria-label={subtaskStatus.label}
                        >
                          {renderStatusIcon('todo')}
                        </div>
                        <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300">
                          {st.title}
                        </span>
                        {st.priority &&
                          st.priority !== 'medium' &&
                          (() => {
                            const opt = priorityOptions.find(
                              (o) => o.value === st.priority,
                            );
                            return opt ? (
                              <span
                                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium text-white ${opt.bgColor}`}
                              >
                                <span className="text-white">{opt.icon}</span>
                                {opt.label}
                              </span>
                            ) : null;
                          })()}
                        {st.estimatedHours && (
                          <span className="flex items-center gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                            <Clock className="w-3 h-3" />
                            {st.estimatedHours}h
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => removeSubtask(st.id)}
                          className="p-1 text-zinc-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {(st.description ||
                        (st.labels && st.labels.length > 0)) && (
                        <div className="ml-8 mt-1 space-y-1">
                          {st.description && (
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                              {st.description}
                            </p>
                          )}
                          {st.labels && st.labels.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {st.labels.map((label) => (
                                <span
                                  key={label}
                                  className="px-1.5 py-0.5 text-xs rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                                >
                                  {label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CompactAccordionGroup>

          <CompactAccordionGroup
            title={t('workflowModeTitle')}
            icon={<Settings2 className="w-3.5 h-3.5" />}
            defaultExpanded={false}
            className="border-b-0"
          >
            <div className="space-y-3">
              <CompactWorkflowSelector
                taskId={0}
                currentMode={workflowMode}
                isOverridden={isWorkflowModeOverride}
                complexityScore={null}
                autoComplexityAnalysis={
                  globalSettings?.autoComplexityAnalysis ?? false
                }
                onModeChange={(mode, isOverride) => {
                  setWorkflowMode(mode);
                  setIsWorkflowModeOverride(isOverride);
                }}
                disabled={false}
                showAnalyzeButton={false}
              />
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  <strong>{t('workflowModeAbout')}</strong>{' '}
                  {t('workflowModeExplanation')}
                </p>
              </div>
            </div>
          </CompactAccordionGroup>
        </div>
      </form>

      <ApplyTemplateDialog
        isOpen={showTemplateDialog}
        onClose={() => setShowTemplateDialog(false)}
        selectedTheme={selectedTheme}
        onApply={handleApplyTemplate}
      />
    </div>
  );
}

// NOTE: Turbopack cannot statically analyze HOC-wrapped default exports in 'use client' files.
// Assigning to a named const before exporting allows Turbopack to detect the default export.
const AuthenticatedNewTaskClient = requireAuth(NewTaskClient);
export default AuthenticatedNewTaskClient;
