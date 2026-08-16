/**
 * supervisor-incident-detectors.test
 *
 * Boundary tests for the four supervisor-derived pure detectors. Fixtures use
 * the REAL measured values from the 2026-08-15 incident set: cwd
 * C:\Projects\rapitas\rapitas-backend vs theme C:\Projects\ime-live-converter,
 * a PR 57s after the failure mark, phase_completed 8s before the backstop, and
 * a verify checklist filled with 対象コードなし. No DB, no mocks.
 */
import { describe, it, expect } from 'bun:test';
import {
  detectCwdMismatch,
  detectFalseFailure,
  detectFalseForceStop,
  detectThemeMisplacement,
  analyzeVerifyChecklist,
  FALSE_FAILURE_WINDOW_MS,
  FORCESTOP_MIN_GAP_MS,
} from './supervisor-incident-detectors';

const NOW = 1_000_000_000_000;

describe('detectCwdMismatch', () => {
  // Real incident values (task 580): the researcher grepped rapitas' own
  // backend instead of the converter project.
  const incident = {
    executionCwd: 'C:\\Projects\\rapitas\\rapitas-backend',
    themeWorkingDirectory: 'C:\\Projects\\ime-live-converter',
  };

  it('detects the real task-580 mismatch and returns both paths as evidence', () => {
    expect(detectCwdMismatch(incident)).toEqual({
      cwd: 'C:\\Projects\\rapitas\\rapitas-backend',
      themeDir: 'C:\\Projects\\ime-live-converter',
    });
  });

  it('does NOT detect an exact match', () => {
    expect(
      detectCwdMismatch({
        executionCwd: 'C:\\Projects\\ime-live-converter',
        themeWorkingDirectory: 'C:\\Projects\\ime-live-converter',
      }),
    ).toBeNull();
  });

  it('does NOT detect a worktree under the theme directory (mutating roles)', () => {
    expect(
      detectCwdMismatch({
        executionCwd: 'C:\\Projects\\ime-live-converter\\.worktrees\\task-580-abc123',
        themeWorkingDirectory: 'C:\\Projects\\ime-live-converter',
      }),
    ).toBeNull();
  });

  it('does NOT detect separator/case/trailing-slash differences only', () => {
    expect(
      detectCwdMismatch({
        executionCwd: 'c:/projects/IME-Live-Converter/',
        themeWorkingDirectory: 'C:\\Projects\\ime-live-converter',
      }),
    ).toBeNull();
  });

  it.each([
    { name: 'themeWorkingDirectory is null', over: { themeWorkingDirectory: null } },
    { name: 'executionCwd is null (no Working directory line)', over: { executionCwd: null } },
  ])('does NOT detect when $name (fail-safe)', ({ over }) => {
    expect(detectCwdMismatch({ ...incident, ...over })).toBeNull();
  });
});

describe('detectFalseFailure', () => {
  // Real incident values (task 580 / PR #7): the PR was created 57 seconds
  // after auto-run declared the completion gate failed.
  const incident = {
    failureMarkedAtMs: NOW,
    successArtifactAtMs: NOW + 57_000,
  };

  it('detects the real task-580 case: a PR 57s after the failure mark', () => {
    expect(detectFalseFailure(incident)).toEqual({ gapMs: 57_000 });
  });

  it('detects at exactly the window boundary (<= inclusive)', () => {
    expect(
      detectFalseFailure({
        failureMarkedAtMs: NOW,
        successArtifactAtMs: NOW + FALSE_FAILURE_WINDOW_MS,
      }),
    ).toEqual({ gapMs: FALSE_FAILURE_WINDOW_MS });
  });

  it('does NOT detect a success outside the window (legitimate later retry)', () => {
    expect(
      detectFalseFailure({
        failureMarkedAtMs: NOW,
        successArtifactAtMs: NOW + FALSE_FAILURE_WINDOW_MS + 1,
      }),
    ).toBeNull();
  });

  it('does NOT detect a success at or before the failure mark (gap <= 0)', () => {
    expect(detectFalseFailure({ failureMarkedAtMs: NOW, successArtifactAtMs: NOW })).toBeNull();
    expect(
      detectFalseFailure({ failureMarkedAtMs: NOW, successArtifactAtMs: NOW - 1_000 }),
    ).toBeNull();
  });

  it.each([
    { name: 'no failure mark exists', over: { failureMarkedAtMs: null } },
    { name: 'no success artifact exists', over: { successArtifactAtMs: null } },
  ])('does NOT detect when $name (fail-safe)', ({ over }) => {
    expect(detectFalseFailure({ ...incident, ...over })).toBeNull();
  });

  it('honors a custom windowMs override', () => {
    expect(detectFalseFailure({ ...incident, windowMs: 60_000 })).toEqual({ gapMs: 57_000 });
    expect(detectFalseFailure({ ...incident, windowMs: 50_000 })).toBeNull();
  });
});

describe('detectFalseForceStop', () => {
  // Real incident values (task 585): the hang backstop force-stopped the
  // implementer 8 seconds after phase_completed:implementer.
  const incident = {
    backstopAtMs: NOW,
    lastProgressAtMs: NOW - 8_000,
  };

  it('detects the real task-585 case: backstop 8s after phase_completed', () => {
    expect(detectFalseForceStop(incident)).toEqual({ gapMs: 8_000 });
  });

  it('detects a zero gap (progress at the same instant)', () => {
    expect(detectFalseForceStop({ backstopAtMs: NOW, lastProgressAtMs: NOW })).toEqual({
      gapMs: 0,
    });
  });

  it('does NOT detect at exactly the threshold (< exclusive)', () => {
    expect(
      detectFalseForceStop({
        backstopAtMs: NOW,
        lastProgressAtMs: NOW - FORCESTOP_MIN_GAP_MS,
      }),
    ).toBeNull();
  });

  it('does NOT detect a genuine hang (last progress 40 minutes before)', () => {
    expect(
      detectFalseForceStop({ backstopAtMs: NOW, lastProgressAtMs: NOW - 40 * 60 * 1000 }),
    ).toBeNull();
  });

  it('does NOT detect progress after the backstop (negative gap)', () => {
    expect(detectFalseForceStop({ backstopAtMs: NOW, lastProgressAtMs: NOW + 1_000 })).toBeNull();
  });

  it.each([
    { name: 'no backstop notification exists', over: { backstopAtMs: null } },
    { name: 'no progress transition exists', over: { lastProgressAtMs: null } },
  ])('does NOT detect when $name (fail-safe)', ({ over }) => {
    expect(detectFalseForceStop({ ...incident, ...over })).toBeNull();
  });

  it('honors a custom thresholdMs override', () => {
    expect(detectFalseForceStop({ ...incident, thresholdMs: 8_001 })).toEqual({ gapMs: 8_000 });
    expect(detectFalseForceStop({ ...incident, thresholdMs: 8_000 })).toBeNull();
  });
});

describe('analyzeVerifyChecklist', () => {
  it('counts ✅/❌/⚠️/[ ]/[x] items and matches no-target vocabulary', () => {
    const stats = analyzeVerifyChecklist(
      [
        '## 検証結果サマリ',
        '- ❌ 対象コードなし',
        '- ❌ 該当なし（テーブルが存在しない）',
        '- ⚠️ 対象ファイルなし',
        '- [ ] レビュー待ち',
        '- [x] lint 実行',
        '本文の段落はカウントしない',
      ].join('\n'),
    );
    expect(stats.total).toBe(5);
    expect(stats.noTargetCount).toBe(3);
    expect(stats.samples).toEqual([
      '- ❌ 対象コードなし',
      '- ❌ 該当なし（テーブルが存在しない）',
      '- ⚠️ 対象ファイルなし',
    ]);
  });

  it('caps samples at 3 and matches N/A case-insensitively', () => {
    const stats = analyzeVerifyChecklist(
      ['- ❌ N/A', '- ❌ 対象なし', '- ❌ 該当せず', '- ❌ 見つかりません'].join('\n'),
    );
    expect(stats.noTargetCount).toBe(4);
    expect(stats.samples).toHaveLength(3);
  });

  it('returns zeros for null / empty / checklist-less content', () => {
    expect(analyzeVerifyChecklist(null)).toEqual({ total: 0, noTargetCount: 0, samples: [] });
    expect(analyzeVerifyChecklist('')).toEqual({ total: 0, noTargetCount: 0, samples: [] });
    expect(analyzeVerifyChecklist('## 概要\nただの文章')).toEqual({
      total: 0,
      noTargetCount: 0,
      samples: [],
    });
  });
});

describe('detectThemeMisplacement', () => {
  it('detects the real task-587 shape: a verify dominated by 対象コードなし (4/5)', () => {
    expect(detectThemeMisplacement({ checklistTotal: 5, noTargetCount: 4 })).toEqual({
      total: 5,
      noTargetCount: 4,
      ratio: 0.8,
    });
  });

  it('detects at exactly the ratio threshold (>= inclusive)', () => {
    expect(
      detectThemeMisplacement({
        checklistTotal: 5,
        noTargetCount: 3,
        ratioThreshold: 0.6,
      }),
    ).toEqual({ total: 5, noTargetCount: 3, ratio: 0.6 });
  });

  it('does NOT detect a normal verify with a minority of no-target items', () => {
    expect(detectThemeMisplacement({ checklistTotal: 5, noTargetCount: 2 })).toBeNull();
  });

  it('does NOT detect below the minimum item count (unstable ratio)', () => {
    expect(detectThemeMisplacement({ checklistTotal: 2, noTargetCount: 2 })).toBeNull();
  });

  it('does NOT detect a missing verify (total 0)', () => {
    expect(detectThemeMisplacement({ checklistTotal: 0, noTargetCount: 0 })).toBeNull();
  });

  it('honors custom minItems / ratioThreshold overrides', () => {
    expect(detectThemeMisplacement({ checklistTotal: 2, noTargetCount: 2, minItems: 2 })).toEqual({
      total: 2,
      noTargetCount: 2,
      ratio: 1,
    });
    expect(
      detectThemeMisplacement({ checklistTotal: 5, noTargetCount: 4, ratioThreshold: 0.9 }),
    ).toBeNull();
  });
});
