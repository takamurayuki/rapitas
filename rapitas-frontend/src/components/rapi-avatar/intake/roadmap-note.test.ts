/**
 * roadmap-note.test
 *
 * The note that outlives the conversation.
 *
 * The tasks say what to do; the note is the only record of why it was going
 * to be done that way — what was asked, what was chosen, what the plan took
 * for granted. Weeks later it is the thing that is read, so it is worth
 * testing as text rather than as a side effect.
 *
 * The comparison table is the part worth being careful about. ラピ cannot
 * look anything up from here, so the note gets the columns to weigh
 * candidates on and nothing in them: a filled-in table would be invented,
 * and an invented salary figure in a note is worse than no note.
 */
import { describe, it, expect } from 'vitest';
import { composeRoadmapNote, type NoteCandidate } from './roadmap-note';

const BASE = {
  goal: '転職する',
  decisions: [{ question: '現職を続けますか', answer: '続けながら活動する' }],
  theme: '転職活動（新規）',
  project: 'なし',
  steps: [{ title: '職務経歴書を作る', dueDate: '2026-11-04' }],
  taskIds: [301],
};

describe('what the note carries', () => {
  it('leads with the goal', () => {
    expect(composeRoadmapNote(BASE).startsWith('# 転職する')).toBe(true);
  });

  it('records the question and the answer together', () => {
    const body = composeRoadmapNote(BASE);
    expect(body).toContain('現職を続けますか → 続けながら活動する');
  });

  it('links each task with its date', () => {
    expect(composeRoadmapNote(BASE)).toContain(
      '- [職務経歴書を作る](/tasks/301?showHeader=true) — 2026-11-04',
    );
  });

  it('shows the deadline it was planned against', () => {
    expect(composeRoadmapNote({ ...BASE, deadline: '2027-01-19' })).toContain('期限: 2027-01-19');
  });
});

describe('the assumptions', () => {
  it('are written down, because nobody remembers them later', () => {
    const body = composeRoadmapNote({
      ...BASE,
      assumptions: ['現職は続けながら活動する', '年収は下げない'],
    });
    expect(body).toContain('## 前提');
    expect(body).toContain('- 現職は続けながら活動する');
    expect(body).toContain('- 年収は下げない');
  });

  it('leave no empty heading behind when there are none', () => {
    expect(composeRoadmapNote(BASE)).not.toContain('## 前提');
  });
});

describe('the comparison table', () => {
  const compared = () =>
    composeRoadmapNote({ ...BASE, comparisonAxes: ['年収', '技術スタック', '働き方'] });

  it('gives a column per axis', () => {
    expect(compared()).toContain('| 候補 | 年収 | 技術スタック | 働き方 |');
  });

  it('is left blank to fill in — she cannot look any of it up', () => {
    const rows = compared()
      .split('\n')
      .filter((l) => l.startsWith('|'));
    // Header, separator, and at least one empty row to type into.
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows[1]).toMatch(/^\|\s*---/);
    expect(rows[rows.length - 1]).toMatch(/^\|\s{2,}\|/);
  });

  it('says nothing at all when the goal is not a choice', () => {
    const body = composeRoadmapNote(BASE);
    expect(body).not.toContain('## 比較');
    expect(body).not.toContain('| 候補 |');
  });
});

describe('when candidates were looked up', () => {
  const FOUND: NoteCandidate[] = [
    {
      name: 'A社',
      sourceUrl: 'https://example.com/a',
      values: { 年収: '600〜800万', 技術スタック: 'TypeScript' },
      why: '自社開発でWeb系',
    },
    {
      name: 'B社',
      sourceUrl: 'https://example.com/b',
      values: { 年収: '350〜600万' },
      why: '技術スタックは確認できなかった',
    },
  ];
  const researched = () =>
    composeRoadmapNote({
      ...BASE,
      comparisonAxes: ['年収', '技術スタック'],
      candidates: FOUND,
      unresolvedAxes: [],
    });

  it('puts each candidate in the table behind its source link', () => {
    expect(researched()).toContain('| [A社](https://example.com/a) | 600〜800万 | TypeScript |');
  });

  it('leaves a cell the search did not establish empty', () => {
    // An invented figure here is read months later as a fact.
    expect(researched()).toContain('| [B社](https://example.com/b) | 350〜600万 |  |');
  });

  it('keeps a row to type into — the list is a start, not the market', () => {
    const rows = researched()
      .split('\n')
      .filter((l) => l.startsWith('|'));
    expect(rows[rows.length - 1]).toMatch(/^\|\s{2,}\|/);
  });

  it('says why each one is on the list', () => {
    expect(researched()).toContain('- A社: 自社開発でWeb系');
  });

  it('names the axes nothing could be found for', () => {
    const body = composeRoadmapNote({
      ...BASE,
      comparisonAxes: ['年収', '働き方'],
      candidates: FOUND,
      unresolvedAxes: ['働き方'],
    });
    expect(body).toContain('調べても分からなかった観点: 働き方');
  });

  it('still gives an empty table when nothing was looked up', () => {
    const body = composeRoadmapNote({ ...BASE, comparisonAxes: ['年収'] });
    expect(body).toContain('| 候補 | 年収 |');
    expect(body).not.toContain('https://');
  });
});
