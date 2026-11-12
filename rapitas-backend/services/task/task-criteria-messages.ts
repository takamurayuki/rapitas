/**
 * task-criteria-messages
 *
 * The person-facing text of each refused criteria write (writeTaskCriteria),
 * shared by the task screen's PATCH and ラピ's criteria routes so both say
 * the same thing. The machine-readable code travels alongside as `code`.
 */
import type { CriteriaWriteRefusal } from './task-criteria-write';

/** Message per refusal code (not_found is answered as 404 by each caller). */
export const CRITERIA_REFUSAL_MESSAGES: Record<
  Exclude<CriteriaWriteRefusal, 'not_found'>,
  string
> = {
  review_in_progress:
    'いまは陪審が確認中（またはレビュー保留・確認済み）なので、完了条件は変えられません。終わってから変えましょう。',
  criteria_changed_since:
    '完了条件は、この画面を開いたあとで変わっています。最新の内容を読み直してから変えてください。',
  task_done: '完了したタスクの完了条件は変えられません。足りない点は追加のタスクにしてください。',
};
