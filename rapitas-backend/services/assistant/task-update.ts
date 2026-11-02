/**
 * TaskUpdate
 *
 * ラピ changing a task's status, priority, theme or due date (#1119 stage 6):
 * validating what was asked, writing only what differs, and undoing it.
 * Not responsible for confirmation or the audit log — the route checks the
 * capability and records the act, keeping before/after so undo has what it needs.
 */

export const TASK_UPDATE_STATUSES = ['todo', 'in-progress', 'done'] as const;
export const TASK_UPDATE_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const FIELDS = ['status', 'priority', 'themeId', 'dueDate'] as const;
type Field = (typeof FIELDS)[number];

/** A validated change set. dueDate is `YYYY-MM-DD`; null clears theme/due date. */
export interface TaskChanges {
  status?: (typeof TASK_UPDATE_STATUSES)[number];
  priority?: (typeof TASK_UPDATE_PRIORITIES)[number];
  themeId?: number | null;
  dueDate?: string | null;
}

/** The values of the changed fields, as stored in the audit log. */
export type FieldValues = Partial<Record<Field, string | number | null>>;

/** The slice of Prisma this module uses — injectable for tests. */
export interface TaskUpdateDb {
  task: {
    findUnique(args: { where: { id: number } }): Promise<{
      status: string;
      priority: string;
      themeId: number | null;
      dueDate: Date | null;
    } | null>;
    update(args: { where: { id: number }; data: Record<string, unknown> }): Promise<unknown>;
  };
  theme: { findUnique(args: { where: { id: number } }): Promise<{ id: number } | null> };
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in YYYY-MM-DD — "2026-13-40" parses in JS but is not one. */
function isCalendarDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

/**
 * Check a raw change request before anything is read or written.
 *
 * @param raw - Untrusted input / 未検証の入力
 * @returns The validated changes, or an error naming the offending field / 検証済みの変更、またはエラー
 */
export function validateTaskChanges(
  raw: Record<string, unknown>,
): { ok: true; changes: TaskChanges } | { ok: false; error: string } {
  const extra = Object.keys(raw).filter((k) => !(FIELDS as readonly string[]).includes(k));
  if (extra.length) return { ok: false, error: `cannot change: ${extra.join(', ')}` };
  const changes: TaskChanges = {};
  if ('status' in raw) {
    if (!TASK_UPDATE_STATUSES.includes(raw.status as never)) {
      return { ok: false, error: `status must be one of ${TASK_UPDATE_STATUSES.join(', ')}` };
    }
    changes.status = raw.status as TaskChanges['status'];
  }
  if ('priority' in raw) {
    if (!TASK_UPDATE_PRIORITIES.includes(raw.priority as never)) {
      return { ok: false, error: `priority must be one of ${TASK_UPDATE_PRIORITIES.join(', ')}` };
    }
    changes.priority = raw.priority as TaskChanges['priority'];
  }
  if ('themeId' in raw) {
    const v = raw.themeId;
    if (v !== null && !(Number.isSafeInteger(v) && (v as number) > 0)) {
      return { ok: false, error: 'themeId must be a positive integer or null' };
    }
    changes.themeId = v as number | null;
  }
  if ('dueDate' in raw) {
    const v = raw.dueDate;
    if (v !== null && !(typeof v === 'string' && isCalendarDate(v))) {
      return { ok: false, error: 'dueDate must be YYYY-MM-DD or null' };
    }
    changes.dueDate = v as string | null;
  }
  if (Object.keys(changes).length === 0) return { ok: false, error: 'nothing to change' };
  return { ok: true, changes };
}

/** A stored value in the form the audit log keeps and compares. */
function comparable(field: Field, row: Awaited<ReturnType<TaskUpdateDb['task']['findUnique']>>) {
  const v = row?.[field] ?? null;
  return field === 'dueDate' && v instanceof Date
    ? v.toISOString().slice(0, 10)
    : (v as string | number | null);
}

/** What to write for a field value taken from the audit log. */
function storable(field: Field, v: string | number | null): unknown {
  return field === 'dueDate' && typeof v === 'string' ? new Date(`${v}T00:00:00.000Z`) : v;
}

/**
 * Apply validated changes, writing only fields whose value actually differs.
 *
 * @param db - Prisma slice / Prisma の一部
 * @param taskId - Task to change / 対象タスク
 * @param changes - Validated changes / 検証済みの変更
 * @returns before/after of what changed, or why nothing was written / 変更前後、または不成立の理由
 */
export async function applyTaskUpdate(
  db: TaskUpdateDb,
  taskId: number,
  changes: TaskChanges,
): Promise<
  | { ok: true; before: FieldValues; after: FieldValues }
  | { ok: false; reason: 'not_found' | 'theme_not_found' | 'no_change' }
> {
  const row = await db.task.findUnique({ where: { id: taskId } });
  // A task in the trash is gone from Task (DeletedTask keeps a copy), so it
  // is simply not found here.
  if (!row) return { ok: false, reason: 'not_found' };
  if (typeof changes.themeId === 'number') {
    if (!(await db.theme.findUnique({ where: { id: changes.themeId } }))) {
      return { ok: false, reason: 'theme_not_found' };
    }
  }
  const before: FieldValues = {};
  const after: FieldValues = {};
  const data: Record<string, unknown> = {};
  for (const field of FIELDS) {
    if (!(field in changes)) continue;
    const next = (changes as Record<Field, string | number | null>)[field];
    const current = comparable(field, row);
    if (current === next) continue;
    before[field] = current;
    after[field] = next;
    data[field] = storable(field, next);
  }
  if (Object.keys(data).length === 0) return { ok: false, reason: 'no_change' };
  await db.task.update({ where: { id: taskId }, data });
  return { ok: true, before, after };
}

/**
 * Undo an update — but only fields still holding the value ラピ wrote.
 *
 * If anyone changed a field since, the whole undo is refused and the field
 * named: restoring half of an act, or overwriting someone's later edit, would
 * both leave the task in a state nobody chose.
 *
 * @param db - Prisma slice / Prisma の一部
 * @param taskId - Task that was changed / 変更されたタスク
 * @param record - before/after from the audit log / 監査ログの変更前後
 * @returns ok, or the fields that changed since / 成否と、その後に変わった項目
 */
export async function revertTaskUpdate(
  db: TaskUpdateDb,
  taskId: number,
  record: { before: FieldValues; after: FieldValues },
): Promise<
  { ok: true } | { ok: false; reason: 'not_found' | 'changed_since'; conflicts?: string[] }
> {
  const row = await db.task.findUnique({ where: { id: taskId } });
  if (!row) return { ok: false, reason: 'not_found' };
  const fields = Object.keys(record.after) as Field[];
  const conflicts = fields.filter((f) => comparable(f, row) !== record.after[f]);
  if (conflicts.length) return { ok: false, reason: 'changed_since', conflicts };
  const data: Record<string, unknown> = {};
  for (const f of fields) data[f] = storable(f, record.before[f] ?? null);
  await db.task.update({ where: { id: taskId }, data });
  return { ok: true };
}
