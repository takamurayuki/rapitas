/**
 * task-spec-requirements.test
 *
 * What a task must say before an agent starts on it (#1555): where it is
 * going (goals), how anyone will know it got there (completion criteria —
 * what the agent checks or what the person checks), and what it hands over
 * (the deliverable, which defaults to a PR). Only development themes, where
 * agents run tasks, require them.
 */
import { describe, it, expect } from 'bun:test';
import {
  DELIVERABLES,
  missingRequiredSpec,
  parseDeliverable,
  requiredSpecQuestion,
  scopeFieldsForWrite,
} from './task-spec-requirements';

const full = {
  goals: '["ログから取り込まれなかった理由が読める"]',
  acceptanceCriteria: '["dev-pull.test.cjs に足したテストが通る"]',
  userAcceptanceChecks: null,
};

describe('what a development task must say', () => {
  it('asks for nothing when goals and a completion criterion are written', () => {
    expect(missingRequiredSpec(full)).toEqual([]);
  });

  it('asks for the goals when there are none', () => {
    expect(missingRequiredSpec({ ...full, goals: null })).toEqual(['goals']);
  });

  it('asks for a completion criterion when neither kind is written', () => {
    expect(missingRequiredSpec({ ...full, acceptanceCriteria: '[]' })).toEqual([
      'completionCriteria',
    ]);
  });

  // A note or a decision may be judged only by the person; that is still a
  // definition of done.
  it('takes what only the person checks as a completion criterion', () => {
    expect(
      missingRequiredSpec({
        ...full,
        acceptanceCriteria: null,
        userAcceptanceChecks: '["ノートを読んで分かる"]',
      }),
    ).toEqual([]);
  });

  it('does not count blank lines as written', () => {
    expect(missingRequiredSpec({ ...full, goals: '["  "]' })).toEqual(['goals']);
  });
});

describe('the deliverable', () => {
  it('reads a known one', () => {
    for (const d of DELIVERABLES) expect(parseDeliverable(d)).toBe(d);
  });

  // Tasks filed by the system (CI watch, concerns) carry no deliverable; a PR
  // is what a development task hands over, so they are not stopped for it.
  it('reads a missing or unknown one as a PR', () => {
    expect(parseDeliverable(null)).toBe('pr');
    expect(parseDeliverable('something')).toBe('pr');
  });
});

describe('the question the task waits on', () => {
  it('names each missing item and says where to fill it in', () => {
    const q = requiredSpecQuestion('ログに理由を残す', ['goals', 'completionCriteria']);
    expect(q).toContain('ゴール');
    expect(q).toContain('完了条件');
    expect(q).toContain('タスクの詳細');
  });
});

describe('writing 範囲外 and 成果物', () => {
  it('writes the out-of-scope list as JSON, without blank lines', () => {
    expect(scopeFieldsForWrite({ outOfScope: ['再起動ボタン', '  '] })).toEqual({
      outOfScope: '["再起動ボタン"]',
    });
  });

  it('clears the list when the last item is removed', () => {
    expect(scopeFieldsForWrite({ outOfScope: [] })).toEqual({ outOfScope: null });
  });

  it('leaves out what was not sent, and an unknown deliverable', () => {
    expect(scopeFieldsForWrite({})).toEqual({});
    expect(scopeFieldsForWrite({ deliverable: 'zip' })).toEqual({});
    expect(scopeFieldsForWrite({ deliverable: 'report' })).toEqual({ deliverable: 'report' });
  });
});
