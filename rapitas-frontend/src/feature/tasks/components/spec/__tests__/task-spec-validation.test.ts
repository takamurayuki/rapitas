/**
 * task-spec-validation.test
 *
 * A task in a development project (one agents run) is not created without
 * its goals and a completion criterion (#1555); the backend would only stop
 * it at the start anyway, so the form asks while the person is still here.
 * Personal tasks are free of it.
 */
import { describe, it, expect } from 'vitest';
import { specErrors, toLines, DELIVERABLE_OPTIONS } from '../task-spec-validation';

const filled = {
  goals: '理由が読める',
  acceptanceCriteria: 'テストが通る',
  userAcceptanceChecks: '',
};

describe('a development project task', () => {
  it('passes with goals and a criterion', () => {
    expect(specErrors(filled, true)).toEqual({});
  });

  it('asks for the goals', () => {
    expect(specErrors({ ...filled, goals: '  \n ' }, true)).toEqual({ goals: 'specErrorGoals' });
  });

  it('asks for a completion criterion of either kind', () => {
    expect(specErrors({ ...filled, acceptanceCriteria: '' }, true)).toEqual({
      completionCriteria: 'specErrorCompletion',
    });
    expect(
      specErrors({ ...filled, acceptanceCriteria: '', userAcceptanceChecks: '見て分かる' }, true),
    ).toEqual({});
  });
});

describe('a personal task', () => {
  it('asks for nothing', () => {
    expect(
      specErrors({ goals: '', acceptanceCriteria: '', userAcceptanceChecks: '' }, false),
    ).toEqual({});
  });
});

describe('helpers', () => {
  it('splits lines and drops blank ones', () => {
    expect(toLines(' a \n\n b ')).toEqual(['a', 'b']);
  });

  // A note is left out until an agent can write one (#1559).
  it('offers the deliverables an agent can produce, PR first', () => {
    expect(DELIVERABLE_OPTIONS).toEqual(['pr', 'report', 'decision']);
  });
});
