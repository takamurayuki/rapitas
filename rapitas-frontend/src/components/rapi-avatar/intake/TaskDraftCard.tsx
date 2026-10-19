'use client';
/**
 * TaskDraftCard
 *
 * What ラピ understood, laid out so the user can correct it before anything
 * is created.
 *
 * Every field is editable and every inferred field says why it looks that
 * way. The theme is the one field with no default: a task always belongs to
 * one and ラピ will not pick it, so the card cannot be filed until it is set.
 *
 * Draws only — the draft and the two actions come from `useTaskDraft`.
 */
import { useTranslations } from 'next-intl';
import { ListPlus } from 'lucide-react';
import {
  DRAFT_PRIORITIES,
  type DraftField,
  type EditableDraft,
  type TaskDraft,
} from './task-draft-types';

interface TaskDraftCardProps {
  draft: TaskDraft;
  edited: EditableDraft;
  fileable: boolean;
  filing: boolean;
  onEdit: (patch: Partial<EditableDraft>) => void;
  onFile: () => void;
  onDiscard: () => void;
}

const FIELD_CLASS =
  'w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';

/** A labelled row, with the reason underneath when there is one. */
function Row({
  label,
  reason,
  children,
}: {
  label: string;
  reason?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
      {reason && <span className="block text-[10px] text-zinc-400">{reason}</span>}
    </label>
  );
}

/**
 * @param props - The proposal, the user's corrections, and what to do with them
 */
export function TaskDraftCard({
  draft,
  edited,
  fileable,
  filing,
  onEdit,
  onFile,
  onDiscard,
}: TaskDraftCardProps) {
  const t = useTranslations('rapiAvatar.intake');

  /**
   * The explanation for a field.
   *
   * The model's reasoning about the theme is its own sentence about this
   * particular utterance, so it is shown verbatim; the pattern reader's
   * reasons are codes and get translated.
   */
  const reasonFor = (field: DraftField): string | undefined => {
    if (field === 'theme' && draft.themeReason) return draft.themeReason;
    const reason = draft.reasons[field];
    if (!reason) return undefined;
    return t(`reason.${reason.code}`, { value: reason.value ?? '' });
  };

  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/50">
      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{t('draftHeading')}</p>

      <Row label={t('field.title')}>
        <input
          className={FIELD_CLASS}
          aria-label={t('field.title')}
          value={edited.title}
          onChange={(e) => onEdit({ title: e.target.value })}
        />
      </Row>

      <Row label={t('field.theme')} reason={reasonFor('theme')}>
        <select
          className={FIELD_CLASS}
          aria-label={t('field.theme')}
          value={edited.themeId ?? ''}
          onChange={(e) => onEdit({ themeId: e.target.value ? Number(e.target.value) : undefined })}
        >
          {/* No theme is preselected when ラピ could not tell — picking one
              for the user is exactly what this card exists to avoid. */}
          <option value="">{t('chooseTheme')}</option>
          {draft.themeCandidates.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.name}
            </option>
          ))}
        </select>
      </Row>

      <div className="grid grid-cols-2 gap-2">
        <Row label={t('field.priority')} reason={reasonFor('priority')}>
          <select
            className={FIELD_CLASS}
            aria-label={t('field.priority')}
            value={edited.priority ?? ''}
            onChange={(e) =>
              onEdit({ priority: (e.target.value || undefined) as EditableDraft['priority'] })
            }
          >
            <option value="">{t('unset')}</option>
            {DRAFT_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`priority.${p}`)}
              </option>
            ))}
          </select>
        </Row>

        <Row label={t('field.estimatedHours')} reason={reasonFor('estimatedHours')}>
          <input
            type="number"
            min={0}
            step={0.5}
            className={FIELD_CLASS}
            aria-label={t('field.estimatedHours')}
            value={edited.estimatedHours ?? ''}
            onChange={(e) =>
              onEdit({ estimatedHours: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </Row>
      </div>

      <Row label={t('field.dueDate')} reason={reasonFor('dueDate')}>
        <input
          type="date"
          className={FIELD_CLASS}
          aria-label={t('field.dueDate')}
          // The draft carries a full ISO string; the picker wants the day.
          value={edited.dueDate ? edited.dueDate.slice(0, 10) : ''}
          onChange={(e) => onEdit({ dueDate: e.target.value || undefined })}
        />
      </Row>

      {/* What "done" means. Editable as plain lines, because criteria nobody
          can reach are a known cause of endless verification bounce-backs —
          the user has to be able to fix them before the task exists. */}
      {edited.acceptanceCriteria !== undefined && (
        <Row label={t('field.acceptanceCriteria')}>
          <textarea
            rows={Math.min(4, Math.max(2, edited.acceptanceCriteria.length))}
            className={FIELD_CLASS}
            aria-label={t('field.acceptanceCriteria')}
            value={edited.acceptanceCriteria.join('\n')}
            onChange={(e) =>
              onEdit({
                acceptanceCriteria: e.target.value
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean),
              })
            }
          />
        </Row>
      )}

      {draft.unclear !== undefined && draft.unclear.length > 0 && (
        <div className="rounded-md bg-amber-50 p-2 dark:bg-amber-950/40">
          <p className="text-[10px] font-medium text-amber-800 dark:text-amber-300">
            {t('unclear')}
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {draft.unclear.map((item) => (
              <li key={item} className="text-[10px] text-amber-800 dark:text-amber-300">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {edited.description && (
        <Row label={t('field.description')}>
          <textarea
            rows={2}
            className={FIELD_CLASS}
            aria-label={t('field.description')}
            value={edited.description}
            onChange={(e) => onEdit({ description: e.target.value })}
          />
        </Row>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onFile}
          disabled={!fileable || filing}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ListPlus className="h-3.5 w-3.5" />
          {filing ? t('filing') : t('file')}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-lg px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          {t('discard')}
        </button>
      </div>
    </div>
  );
}
