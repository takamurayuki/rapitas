/**
 * scope-contamination.test
 *
 * Unit tests for the pure history-contamination classifier. Covers the five
 * cases from research.md's test strategy: all-pre-session, all-in-session,
 * uncommitted-only, mixed, and empty input — plus the sessionCommitShas
 * branch and timestamp-robustness edge cases. No mocking — the function is pure.
 */
import { describe, it, expect } from 'bun:test';
import { classifyScopeContamination } from './scope-contamination';

const SESSION_START = '2026-08-01T10:00:00+09:00';
const BEFORE_SESSION = '2026-08-01T09:00:00+09:00';
const AFTER_SESSION = '2026-08-01T11:00:00+09:00';

describe('classifyScopeContamination', () => {
  it('classifies a file touched only by pre-session commits as contaminated', () => {
    const result = classifyScopeContamination({
      offendingFiles: ['src/other-task.ts'],
      touchingCommits: [{ file: 'src/other-task.ts', sha: 'aaa111', committedAt: BEFORE_SESSION }],
      sessionStartedAt: SESSION_START,
    });
    expect(result.historyContaminated).toBe(true);
    expect(result.contaminatedFiles).toEqual(['src/other-task.ts']);
    expect(result.inSessionFiles).toEqual([]);
  });

  it('classifies a file touched only by post-session commits as in-session', () => {
    const result = classifyScopeContamination({
      offendingFiles: ['src/mine.ts'],
      touchingCommits: [{ file: 'src/mine.ts', sha: 'bbb222', committedAt: AFTER_SESSION }],
      sessionStartedAt: SESSION_START,
    });
    expect(result.historyContaminated).toBe(false);
    expect(result.contaminatedFiles).toEqual([]);
    expect(result.inSessionFiles).toEqual(['src/mine.ts']);
  });

  it('classifies a file with NO touching commits (uncommitted only) as in-session — fail-safe', () => {
    const result = classifyScopeContamination({
      offendingFiles: ['src/uncommitted.ts'],
      touchingCommits: [],
      sessionStartedAt: SESSION_START,
    });
    expect(result.historyContaminated).toBe(false);
    expect(result.inSessionFiles).toEqual(['src/uncommitted.ts']);
  });

  it('splits a mixed set: only the pre-session file is contaminated', () => {
    const result = classifyScopeContamination({
      offendingFiles: ['src/old.ts', 'src/new.ts', 'src/untracked.ts'],
      touchingCommits: [
        { file: 'src/old.ts', sha: 'aaa111', committedAt: BEFORE_SESSION },
        { file: 'src/new.ts', sha: 'bbb222', committedAt: AFTER_SESSION },
      ],
      sessionStartedAt: SESSION_START,
    });
    expect(result.historyContaminated).toBe(true);
    expect(result.contaminatedFiles).toEqual(['src/old.ts']);
    expect(result.inSessionFiles).toEqual(['src/new.ts', 'src/untracked.ts']);
  });

  it('returns not-contaminated for an empty offendingFiles list', () => {
    const result = classifyScopeContamination({
      offendingFiles: [],
      touchingCommits: [],
      sessionStartedAt: SESSION_START,
    });
    expect(result.historyContaminated).toBe(false);
    expect(result.contaminatedFiles).toEqual([]);
    expect(result.inSessionFiles).toEqual([]);
  });

  it('flags a file when ANY of its touching commits predates the session', () => {
    const result = classifyScopeContamination({
      offendingFiles: ['src/both.ts'],
      touchingCommits: [
        { file: 'src/both.ts', sha: 'bbb222', committedAt: AFTER_SESSION },
        { file: 'src/both.ts', sha: 'aaa111', committedAt: BEFORE_SESSION },
      ],
      sessionStartedAt: SESSION_START,
    });
    expect(result.contaminatedFiles).toEqual(['src/both.ts']);
  });

  it('flags a post-session commit missing from a non-empty sessionCommitShas list', () => {
    const result = classifyScopeContamination({
      offendingFiles: ['src/foreign.ts'],
      touchingCommits: [{ file: 'src/foreign.ts', sha: 'ccc333', committedAt: AFTER_SESSION }],
      sessionStartedAt: SESSION_START,
      sessionCommitShas: ['ddd444'],
    });
    expect(result.historyContaminated).toBe(true);
    expect(result.contaminatedFiles).toEqual(['src/foreign.ts']);
  });

  it('does NOT use the sha check when sessionCommitShas is empty (default)', () => {
    const result = classifyScopeContamination({
      offendingFiles: ['src/mine.ts'],
      touchingCommits: [{ file: 'src/mine.ts', sha: 'eee555', committedAt: AFTER_SESSION }],
      sessionStartedAt: SESSION_START,
      sessionCommitShas: [],
    });
    expect(result.historyContaminated).toBe(false);
  });

  it('treats an unparseable commit timestamp as in-session — fail-safe', () => {
    const result = classifyScopeContamination({
      offendingFiles: ['src/odd.ts'],
      touchingCommits: [{ file: 'src/odd.ts', sha: 'fff666', committedAt: 'not-a-date' }],
      sessionStartedAt: SESSION_START,
    });
    expect(result.historyContaminated).toBe(false);
    expect(result.inSessionFiles).toEqual(['src/odd.ts']);
  });

  it('ignores touching commits belonging to other files', () => {
    const result = classifyScopeContamination({
      offendingFiles: ['src/a.ts'],
      touchingCommits: [{ file: 'src/b.ts', sha: 'aaa111', committedAt: BEFORE_SESSION }],
      sessionStartedAt: SESSION_START,
    });
    // src/a.ts has no touching commits of its own → in-session.
    expect(result.historyContaminated).toBe(false);
    expect(result.inSessionFiles).toEqual(['src/a.ts']);
  });
});
