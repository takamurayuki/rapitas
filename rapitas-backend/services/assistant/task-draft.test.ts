import { describe, expect, test } from 'bun:test';
import { buildTaskDraft, type ThemeRef } from './task-draft';

const THEMES: ThemeRef[] = [
  { id: 1, name: 'rapitas' },
  { id: 2, name: 'TOEICの資格勉強' },
  { id: 36, name: '健康' },
];

describe('buildTaskDraft', () => {
  test('keeps the whole utterance as the description, so nothing said is lost', () => {
    const text = '緊急 rapitas のアバターに入力欄をつける 明日まで 3時間';
    const draft = buildTaskDraft(text, THEMES);
    expect(draft.description).toBe(text);
    expect(draft.title).not.toBe(text);
    expect(draft.title.length).toBeGreaterThan(0);
  });

  test('leaves the description off when the title already is the whole utterance', () => {
    const draft = buildTaskDraft('買い物に行く', []);
    expect(draft.description).toBeUndefined();
  });

  test('reads priority, due date and estimate out of the prose', () => {
    const draft = buildTaskDraft('緊急 会議の準備 3時間', THEMES);
    expect(draft.priority).toBe('urgent');
    expect(draft.estimatedHours).toBe(3);
  });

  describe('the theme', () => {
    test('is picked when exactly one theme name appears', () => {
      const draft = buildTaskDraft('rapitas のアバターを直す', THEMES);
      expect(draft.themeId).toBe(1);
      expect(draft.reasons.theme).toEqual({ code: 'matchedThemeName', value: 'rapitas' });
      expect(draft.missing).not.toContain('theme');
    });

    test('is left to the user when two theme names appear', () => {
      const draft = buildTaskDraft('rapitas と 健康 の両方に関係する', THEMES);
      expect(draft.themeId).toBeUndefined();
      expect(draft.missing).toContain('theme');
      expect(draft.themeCandidates.map((t) => t.id).sort()).toEqual([1, 36]);
    });

    test('is left to the user when no theme name appears, with every theme offered', () => {
      const draft = buildTaskDraft('ゴミを出す', THEMES);
      expect(draft.themeId).toBeUndefined();
      expect(draft.missing).toContain('theme');
      expect(draft.themeCandidates).toHaveLength(3);
    });

    // A task always belongs to a theme, so a draft without one is never fileable.
    test('is always missing when there are no themes at all', () => {
      const draft = buildTaskDraft('何かする', []);
      expect(draft.missing).toContain('theme');
      expect(draft.themeCandidates).toHaveLength(0);
    });

    test('matches case-insensitively', () => {
      const draft = buildTaskDraft('RAPITAS の不具合を直す', THEMES);
      expect(draft.themeId).toBe(1);
    });
  });

  describe('what it refuses to guess', () => {
    test('reports a missing title rather than inventing one', () => {
      const draft = buildTaskDraft('   ', THEMES);
      expect(draft.missing).toContain('title');
    });

    test('says nothing about priority when the prose does not', () => {
      const draft = buildTaskDraft('rapitas の調査', THEMES);
      expect(draft.priority).toBeUndefined();
      expect(draft.reasons.priority).toBeUndefined();
    });

    test('says nothing about an estimate when the prose does not', () => {
      const draft = buildTaskDraft('rapitas の調査', THEMES);
      expect(draft.estimatedHours).toBeUndefined();
    });
  });

  // The whole point of a draft: it is a proposal, not a write. Every reason it
  // gives has to be a code the UI can translate, never a baked Japanese string,
  // or the explanation breaks the moment the locale changes.
  describe('it is a proposal', () => {
    test('carries no id, because nothing was created', () => {
      const draft = buildTaskDraft('rapitas のアバターを直す 2時間', THEMES);
      expect('id' in draft).toBe(false);
    });

    test('explains itself in codes, not in a fixed language', () => {
      const draft = buildTaskDraft('緊急 rapitas の対応 2時間', THEMES);
      for (const reason of Object.values(draft.reasons)) {
        expect(typeof reason.code).toBe('string');
        expect(reason.code).toMatch(/^[a-zA-Z]+$/);
      }
    });
  });
});
