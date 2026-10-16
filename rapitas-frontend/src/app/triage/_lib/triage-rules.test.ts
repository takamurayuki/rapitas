import { describe, it, expect } from 'vitest';
import {
  CONFIRMATION_AMOUNT_THRESHOLD,
  extractApprovalAmount,
  requiresConfirmation,
  describeTriageItem,
  resolveTriageKey,
  type TriageKeyBinding,
} from './triage-rules';

const bindings: TriageKeyBinding[] = [
  { action: 'approve', key: 'a', meta: false, ctrl: false, shift: false },
  { action: 'defer', key: 'h', meta: false, ctrl: false, shift: false },
  { action: 'reject', key: 'r', meta: false, ctrl: false, shift: false },
  { action: 'next', key: 'n', meta: false, ctrl: false, shift: false },
];

const ev = (key: string, extra: Partial<Parameters<typeof resolveTriageKey>[0]> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  targetTag: 'BODY',
  isContentEditable: false,
  ...extra,
});

describe('requiresConfirmation', () => {
  it('threshold is 10000', () => expect(CONFIRMATION_AMOUNT_THRESHOLD).toBe(10000));
  it('10000 exactly does not require confirmation', () =>
    expect(requiresConfirmation(10000)).toBe(false));
  it('10001 requires confirmation', () => expect(requiresConfirmation(10001)).toBe(true));
  it('null (amount unknown) requires confirmation', () =>
    expect(requiresConfirmation(null)).toBe(true));
});

describe('extractApprovalAmount', () => {
  it('reads numeric amount from proposedChanges', () => {
    expect(extractApprovalAmount({ proposedChanges: { amount: 5000 } })).toBe(5000);
  });
  it('falls back to estimatedChanges', () => {
    expect(
      extractApprovalAmount({ proposedChanges: {}, estimatedChanges: { amount: 20000 } }),
    ).toBe(20000);
  });
  it('returns null for string / missing / non-finite amounts', () => {
    expect(extractApprovalAmount({ proposedChanges: { amount: '5000' } })).toBeNull();
    expect(extractApprovalAmount({ proposedChanges: {} })).toBeNull();
    expect(extractApprovalAmount({ proposedChanges: { amount: NaN } })).toBeNull();
  });
  it('string amount is treated as needing confirmation', () => {
    const a = extractApprovalAmount({ proposedChanges: { amount: '5000' } });
    expect(requiresConfirmation(a)).toBe(true);
  });
});

describe('describeTriageItem', () => {
  it('puts kind, summary, impact first in that order', () => {
    const d = describeTriageItem({
      requestType: 'subtask_creation',
      title: 'Split the task',
      proposedChanges: { subtasks: [{}, {}, {}] },
    });
    expect(d.fields.map((f) => f.field)).toEqual(['kind', 'summary', 'impact']);
    expect(d.fields[0].value).toBe('subtask_creation');
    expect(d.fields[1].value).toBe('Split the task');
    expect(d.impact).toEqual({ subtasks: 3, files: null });
  });
  it('uses file count for impact when present', () => {
    const d = describeTriageItem({
      requestType: 'code_review',
      title: 't',
      proposedChanges: { files: ['a', 'b'] },
      estimatedChanges: { filesChanged: 7 },
    });
    expect(d.impact.files).toBe(7);
  });
});

describe('resolveTriageKey', () => {
  it('maps bound keys to actions', () => {
    expect(resolveTriageKey(ev('a'), bindings)).toBe('approve');
    expect(resolveTriageKey(ev('H'), bindings)).toBe('defer');
    expect(resolveTriageKey(ev('r'), bindings)).toBe('reject');
    expect(resolveTriageKey(ev('n'), bindings)).toBe('next');
  });
  it('maps fixed keys', () => {
    expect(resolveTriageKey(ev('u'), bindings)).toBe('undo');
    expect(resolveTriageKey(ev('l'), bindings)).toBe('reload');
    expect(resolveTriageKey(ev('Escape'), bindings)).toBe('cancel');
  });
  it('ignores keys while typing in form controls', () => {
    expect(resolveTriageKey(ev('a', { targetTag: 'INPUT' }), bindings)).toBeNull();
    expect(resolveTriageKey(ev('a', { targetTag: 'TEXTAREA' }), bindings)).toBeNull();
    expect(resolveTriageKey(ev('a', { isContentEditable: true }), bindings)).toBeNull();
  });
  it('ignores browser/SR modified presses', () => {
    expect(resolveTriageKey(ev('a', { ctrlKey: true }), bindings)).toBeNull();
    expect(resolveTriageKey(ev('a', { metaKey: true }), bindings)).toBeNull();
    expect(resolveTriageKey(ev('a', { altKey: true }), bindings)).toBeNull();
  });
  it('returns null for unbound keys', () => {
    expect(resolveTriageKey(ev('z'), bindings)).toBeNull();
  });
});
