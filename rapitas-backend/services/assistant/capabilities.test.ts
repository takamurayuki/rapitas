import { describe, expect, test } from 'bun:test';
import {
  ASSISTANT_CAPABILITIES,
  assertCapabilityAllowed,
  getCapability,
  isCapabilityId,
  UnknownCapabilityError,
  ConfirmationRequiredError,
} from './capabilities';

describe('the registry', () => {
  test('declares at least what ラピ can do today', () => {
    expect(isCapabilityId('task.draft')).toBe(true);
    expect(isCapabilityId('task.create')).toBe(true);
  });

  test('has no duplicate ids', () => {
    const ids = ASSISTANT_CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('ids are dotted lower-case, so they stay usable as log keys', () => {
    for (const capability of ASSISTANT_CAPABILITIES) {
      expect(capability.id).toMatch(/^[a-z]+(\.[a-z-]+)+$/);
    }
  });

  // The invariant the registry exists for. A later capability that changes
  // data cannot be added without someone having to confirm it, because this
  // fails the moment one is.
  test('nothing that writes may run unconfirmed', () => {
    const unguarded = ASSISTANT_CAPABILITIES.filter((c) => c.writes && !c.requiresConfirmation);
    expect(unguarded.map((c) => c.id)).toEqual([]);
  });

  // An unreversible write is allowed to exist, but never silently: it has to
  // say so, so the UI can warn and the roadmap can see what is outstanding.
  test('every capability states what undoing it takes', () => {
    for (const capability of ASSISTANT_CAPABILITIES) {
      expect(['nothing-to-undo', 'delete-what-was-made', 'not-yet-possible']).toContain(
        capability.undo,
      );
    }
  });

  test('a read-only capability has nothing to undo', () => {
    for (const capability of ASSISTANT_CAPABILITIES.filter((c) => !c.writes)) {
      expect(capability.undo).toBe('nothing-to-undo');
    }
  });
});

describe('getCapability', () => {
  test('returns the declaration', () => {
    expect(getCapability('task.draft').writes).toBe(false);
    expect(getCapability('task.create').writes).toBe(true);
  });

  test('refuses an id nobody declared', () => {
    // @ts-expect-error — the point is the runtime guard, not the type
    expect(() => getCapability('task.delete')).toThrow(UnknownCapabilityError);
  });
});

describe('assertCapabilityAllowed', () => {
  test('lets a read-only capability through without confirmation', () => {
    expect(() => assertCapabilityAllowed('task.draft', { confirmed: false })).not.toThrow();
  });

  test('refuses a writing capability that was not confirmed', () => {
    expect(() => assertCapabilityAllowed('task.create', { confirmed: false })).toThrow(
      ConfirmationRequiredError,
    );
  });

  test('lets a writing capability through once it is confirmed', () => {
    expect(() => assertCapabilityAllowed('task.create', { confirmed: true })).not.toThrow();
  });

  test('refuses an undeclared capability whatever the confirmation says', () => {
    // @ts-expect-error — runtime guard again
    expect(() => assertCapabilityAllowed('task.delete', { confirmed: true })).toThrow(
      UnknownCapabilityError,
    );
  });
});
