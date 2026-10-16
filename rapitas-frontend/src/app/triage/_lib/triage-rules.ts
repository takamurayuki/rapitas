/**
 * triage-rules
 *
 * Pure rules for the decision-triage stream: amount extraction, the
 * irreversible-action threshold, item description order, and key resolution.
 * Not responsible for React state, network calls, or translated wording.
 */

/** Approvals above this amount (JPY) need an explicit confirmation step. */
export const CONFIRMATION_AMOUNT_THRESHOLD = 10000;

/** Fixed keys: only the four main actions are user-configurable. */
export const TRIAGE_UNDO_KEY = 'u';
export const TRIAGE_RELOAD_KEY = 'l';

/** Minimal approval snapshot the triage stream works on. */
export interface TriageItem {
  id: number;
  requestType: string;
  title: string;
  proposedChanges: Record<string, unknown>;
  estimatedChanges: Record<string, unknown> | null;
  /** ISO timestamp captured at fetch time; sent back as expectedUpdatedAt. */
  updatedAt: string;
}

export type TriageAction = 'approve' | 'defer' | 'reject' | 'next';
export type TriageKeyAction = TriageAction | 'undo' | 'reload' | 'cancel';

/**
 * Read the approval amount from the item's JSON payloads.
 *
 * NOTE: the schema has no amount column; a numeric `amount` in proposedChanges
 * or estimatedChanges is the only place it can live. This is the single point
 * to adapt if the real payload key differs.
 *
 * @param item - Fields carrying the JSON payloads / 金額を含むJSON
 * @returns Finite amount, or null when absent or not a number / 金額、不明ならnull
 */
export function extractApprovalAmount(item: {
  proposedChanges?: Record<string, unknown> | null;
  estimatedChanges?: Record<string, unknown> | null;
}): number | null {
  for (const source of [item.proposedChanges, item.estimatedChanges]) {
    const value = source?.amount;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Whether approving needs a confirmation step before it is committed.
 * Unknown amount is treated as needing confirmation so an irreversible
 * approval is never waved through on missing data.
 *
 * @param amount - Result of extractApprovalAmount / 抽出済み金額
 */
export function requiresConfirmation(amount: number | null): boolean {
  return amount === null ? true : amount > CONFIRMATION_AMOUNT_THRESHOLD;
}

/** Ordered presentation of an item: kind, summary, impact come first. */
export interface TriageItemDescription {
  fields: Array<{ field: 'kind' | 'summary' | 'impact'; value: string }>;
  impact: { subtasks: number | null; files: number | null };
  amount: number | null;
}

/**
 * Build the head-first description (kind -> summary -> impact) so a listener
 * has what is needed to decide before any detail.
 *
 * @param item - Approval snapshot / 承認要求
 */
export function describeTriageItem(item: {
  requestType: string;
  title: string;
  proposedChanges?: Record<string, unknown> | null;
  estimatedChanges?: Record<string, unknown> | null;
}): TriageItemDescription {
  const subtasks = item.proposedChanges?.subtasks;
  const files = item.proposedChanges?.files;
  const filesChanged = item.estimatedChanges?.filesChanged;
  const impact = {
    subtasks: Array.isArray(subtasks) ? subtasks.length : null,
    files:
      typeof filesChanged === 'number' ? filesChanged : Array.isArray(files) ? files.length : null,
  };
  return {
    fields: [
      { field: 'kind', value: item.requestType },
      { field: 'summary', value: item.title },
      { field: 'impact', value: JSON.stringify(impact) },
    ],
    impact,
    amount: extractApprovalAmount(item),
  };
}

/** A configured key for one of the four main actions. */
export interface TriageKeyBinding {
  action: TriageAction;
  key: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
}

/** Subset of KeyboardEvent the resolver needs (kept plain for testing). */
export interface TriageKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  targetTag: string;
  isContentEditable: boolean;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Map a key event to a triage action.
 * Ignored while typing in form controls and for Alt-combos, so browser and
 * screen-reader shortcuts keep working.
 *
 * @param e - Plain key event / キーイベント
 * @param bindings - Configured main-action bindings / 設定済みキー
 * @returns Action, or null when the event is not a triage key / 対象外ならnull
 */
export function resolveTriageKey(
  e: TriageKeyEvent,
  bindings: TriageKeyBinding[],
): TriageKeyAction | null {
  if (TYPING_TAGS.has(e.targetTag) || e.isContentEditable || e.altKey) return null;
  const key = e.key.toLowerCase();
  const modifier = e.ctrlKey || e.metaKey;

  for (const b of bindings) {
    if (b.key.toLowerCase() !== key) continue;
    if (modifier !== (b.meta || b.ctrl)) continue;
    if (e.shiftKey !== b.shift) continue;
    return b.action;
  }

  if (modifier || e.shiftKey) return null;
  if (key === TRIAGE_UNDO_KEY) return 'undo';
  if (key === TRIAGE_RELOAD_KEY) return 'reload';
  if (e.key === 'Escape') return 'cancel';
  return null;
}
