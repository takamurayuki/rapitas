/**
 * task-draft-types
 *
 * The shape of what `POST /assistant/task-draft` proposes.
 *
 * Mirrors `rapitas-backend/services/assistant/task-draft.ts`. The two are not
 * linked by a shared package, so a change there has to be made here too — the
 * draft deliberately carries no task id, and that absence is the contract.
 */

/** A theme the draft could be filed under. */
export interface DraftThemeRef {
  id: number;
  name: string;
}

/** A field of the draft the user may have to decide for themselves. */
export type DraftField = 'title' | 'theme' | 'priority' | 'dueDate' | 'estimatedHours';

/** Task priorities, in the order the picker offers them. */
export const DRAFT_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;

export type DraftPriority = (typeof DRAFT_PRIORITIES)[number];

/**
 * Why a field looks the way it does.
 *
 * A code rather than a sentence, so the explanation can be translated — see
 * the `rapiAvatar.intake.reason.*` messages.
 */
export interface DraftReason {
  code: 'matchedThemeName' | 'parsedFromText';
  value?: string;
}

/** Which reader produced a draft. */
export type DraftSource =
  /** The model read what the user meant. */
  | 'intent'
  /** The model was unavailable; fields were pattern-matched instead. */
  | 'patterns';

/** A proposed task. Carries no id, because nothing has been created. */
export interface TaskDraft {
  title: string;
  description?: string;
  priority?: DraftPriority;
  dueDate?: string;
  estimatedHours?: number;
  themeId?: number;
  themeCandidates: DraftThemeRef[];
  missing: DraftField[];
  reasons: Partial<Record<DraftField, DraftReason>>;
  /**
   * Why that theme, in the model's own words.
   *
   * Free text rather than a translatable code: it is the model's reasoning
   * about this particular sentence, which no catalogue entry could carry.
   */
  themeReason?: string;
  /** What the model proposes "done" means, for the user to accept or edit. */
  acceptanceCriteria?: string[];
  /** What it could not work out and declined to guess. */
  unclear?: string[];
}

/**
 * The draft as the user has it on screen, after any corrections.
 *
 * Separate from `TaskDraft` because what gets filed is what the user approved,
 * not what was proposed — the two diverge the moment they touch a field.
 */
export interface EditableDraft {
  title: string;
  acceptanceCriteria?: string[];
  description?: string;
  priority?: DraftPriority;
  dueDate?: string;
  estimatedHours?: number;
  themeId?: number;
}

/**
 * Whether a draft can be filed as it stands.
 *
 * A task always belongs to a theme and always has a title, so those two are
 * the gate. Everything else is optional in the task model and stays optional
 * here.
 *
 * @param draft - The draft as edited / 編集後の下書き
 * @returns True when it can be filed / 起票可能なら true
 */
export function isFileable(draft: EditableDraft): boolean {
  return draft.title.trim().length > 0 && typeof draft.themeId === 'number';
}
