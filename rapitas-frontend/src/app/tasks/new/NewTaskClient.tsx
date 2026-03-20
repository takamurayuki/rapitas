/**
 * NewTaskClient
 *
 * Page-level orchestrator for the new-task creation flow.
 * Composes sub-components and delegates all state/logic to useNewTaskForm.
 */
'use client';
import { Layers, Flag, FileText, Settings2, CheckCircle2, Sparkles, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import LabelSelector from '@/feature/tasks/components/LabelSelector';
import TaskTitleAutocomplete from '@/feature/tasks/components/TaskTitleAutocomplete';
import {
  CompactAccordionGroup,
  InlineFieldGroup,
  FieldItem,
} from '@/components/ui/accordion';
import ApplyTemplateDialog from '@/feature/tasks/components/dialog/ApplyTemplateDialog';
import TaskSuggestions from '@/feature/tasks/components/TaskSuggestions';
import { RelatedKnowledgePanel } from '@/feature/intelligence/components/RelatedKnowledgePanel';
import { requireAuth } from '@/contexts/AuthContext';
import { Calendar, Clock, Tag } from 'lucide-react';
import {
  NewTaskHeader,
  PrioritySelector,
  ThemeSelector,
  SubtaskForm,
  SubtaskList,
  WorkflowSection,
  usePriorityOptions,
} from './components';
import { useNewTaskForm } from './hooks';

function NewTaskClient() {
  const form = useNewTaskForm();
  const t = useTranslations('task');
  const tc = useTranslations('common');
  const priorityOptions = usePriorityOptions(t);

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-background scrollbar-thin">
      <NewTaskHeader
        isSubmitting={form.isSubmitting}
        hasTitle={form.title.trim().length > 0}
        appliedTemplate={form.appliedTemplate}
        onOpenTemplate={() => form.setShowTemplateDialog(true)}
        onSubmit={form.handleSubmit}
      />

      <form
        onSubmit={(e) => form.handleSubmit(e)}
        className="max-w-2xl mx-auto px-4 pb-8"
      >
        <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl shadow-zinc-200/50 dark:shadow-none border border-zinc-200/50 dark:border-zinc-800 overflow-hidden">

          {/* Task title */}
          <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
            <TaskTitleAutocomplete
              value={form.title}
              onChange={form.setTitle}
              placeholder={t('taskNamePlaceholder')}
              autoFocus
              themeId={form.themeId}
            />
          </div>

          {/* Priority + Theme inline row */}
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
            <InlineFieldGroup>
              <FieldItem
                label={t('priority')}
                icon={<Flag className="w-3.5 h-3.5" />}
                className="flex-1"
              >
                <PrioritySelector
                  value={form.priority}
                  onChange={form.setPriority}
                  options={priorityOptions}
                />
              </FieldItem>

              <FieldItem
                label={t('theme')}
                icon={<Layers className="w-3.5 h-3.5" />}
                className="flex-1"
              >
                <ThemeSelector
                  themes={form.visibleThemes}
                  themeId={form.themeId}
                  onSelect={form.handleThemeSelect}
                />
              </FieldItem>
            </InlineFieldGroup>
          </div>

          {/* Task suggestions */}
          <TaskSuggestions themeId={form.themeId} onApply={form.handleApplySuggestion} />

          {/* Description accordion */}
          <CompactAccordionGroup
            title={t('description')}
            icon={<FileText className="w-3.5 h-3.5" />}
            defaultExpanded={true}
            headerExtra={
              <button
                type="button"
                onClick={() => form.handleGenerateTitle(false)}
                disabled={!form.description.trim() || form.isGeneratingTitle}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400 hover:bg-violet-200 dark:hover:bg-violet-900 disabled:opacity-40 disabled:cursor-not-allowed"
                title={t('titleGenerateTooltip')}
              >
                {form.isGeneratingTitle ? (
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
              value={form.description}
              onChange={(e) => {
                form.setDescription(e.target.value);
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = `${Math.max(el.scrollHeight, 84)}px`;
              }}
              placeholder={t('taskDetailPlaceholder')}
              className="w-full min-h-[84px] bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-4 py-3 text-sm border-none outline-none resize-none focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            />
          </CompactAccordionGroup>

          {/* Related knowledge panel (shown when title is meaningful) */}
          {form.title.length >= 3 && (
            <RelatedKnowledgePanel
              title={form.title}
              description={form.description || null}
              themeId={form.themeId}
            />
          )}

          {/* Advanced settings accordion */}
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
                      value={form.dueDate}
                      onChange={(e) => form.setDueDate(e.target.value)}
                      className="flex-1 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2 text-sm border-none outline-none focus:ring-2 focus:ring-blue-500/20 transition-all dark:scheme:dark"
                    />
                    {form.dueDate && (
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 shrink-0">
                        (
                        {new Date(form.dueDate).toLocaleDateString(form.dateLocale, {
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
                      value={form.estimatedHours}
                      onChange={(e) => form.setEstimatedHours(e.target.value)}
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
                  selectedLabelIds={form.selectedLabelIds}
                  onChange={form.setSelectedLabelIds}
                />
              </FieldItem>
            </div>
          </CompactAccordionGroup>

          {/* Subtasks accordion */}
          <CompactAccordionGroup
            title={t('subtasks')}
            icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
            badge={
              <span className="px-2 py-0.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 rounded-full">
                {form.subtasks.length}
              </span>
            }
            defaultExpanded
            className="border-b-0"
          >
            <SubtaskForm
              title={form.newSubtaskTitle}
              description={form.newSubtaskDescription}
              priority={form.newSubtaskPriority}
              labels={form.newSubtaskLabels}
              estimatedHours={form.newSubtaskEstimatedHours}
              onTitleChange={form.setNewSubtaskTitle}
              onDescriptionChange={form.setNewSubtaskDescription}
              onPriorityChange={form.setNewSubtaskPriority}
              onLabelsChange={form.setNewSubtaskLabels}
              onEstimatedHoursChange={form.setNewSubtaskEstimatedHours}
              onAdd={form.addSubtask}
              onReset={form.resetSubtaskForm}
            />

            <SubtaskList
              subtasks={form.subtasks}
              priorityOptions={priorityOptions}
              onRemove={form.removeSubtask}
            />
          </CompactAccordionGroup>

          {/* Workflow mode accordion */}
          <CompactAccordionGroup
            title={t('workflowModeTitle')}
            icon={<Settings2 className="w-3.5 h-3.5" />}
            defaultExpanded={false}
            className="border-b-0"
          >
            <WorkflowSection
              workflowMode={form.workflowMode}
              isWorkflowModeOverride={form.isWorkflowModeOverride}
              autoComplexityAnalysis={form.globalSettings?.autoComplexityAnalysis ?? false}
              onModeChange={(mode, isOverride) => {
                form.setWorkflowMode(mode);
                form.setIsWorkflowModeOverride(isOverride);
              }}
            />
          </CompactAccordionGroup>
        </div>
      </form>

      <ApplyTemplateDialog
        isOpen={form.showTemplateDialog}
        onClose={() => form.setShowTemplateDialog(false)}
        selectedTheme={form.selectedTheme}
        onApply={form.handleApplyTemplate}
      />
    </div>
  );
}

// NOTE: Turbopack cannot statically analyze HOC-wrapped default exports in 'use client' files.
// Assigning to a named const before exporting allows Turbopack to detect the default export.
const AuthenticatedNewTaskClient = requireAuth(NewTaskClient);
export default AuthenticatedNewTaskClient;
