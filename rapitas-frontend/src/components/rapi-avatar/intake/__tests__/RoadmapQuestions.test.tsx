/**
 * RoadmapQuestions.test
 *
 * One question at a time, advancing as they are answered.
 *
 * The interview used to draw every question it had at once. In a 320px
 * panel that is a wall: four questions with their options and their reasons
 * push the plan they are about off the screen, and nothing says how far
 * through you are. Asked for 2026-10-22 — "回答したら次の質問へ自動遷移する
 *事で画面をコンパクトに".
 *
 * So the shape under test is: the first unanswered question is the only one
 * open, answering it moves to the next on its own, and what has been decided
 * stays visible as one line each so it can still be changed.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${ns}.${key}:${Object.values(vals).join('/')}` : `${ns}.${key}`,
}));

import { RoadmapQuestions } from '../RoadmapQuestions';

const QUESTIONS = [
  {
    question: '現職を続けながら活動しますか',
    options: ['続けながら', '退職して集中'],
    recommended: '続けながら',
    recommendedReason: '収入が途切れないため',
  },
  { question: '希望の業種は', options: ['SaaS', '受託'] },
  { question: '勤務地の希望は', options: ['首都圏', 'フルリモート'] },
];

/** Render with answers held outside, the way the roadmap holds them. */
function open(initial: Record<number, string> = {}) {
  let answers = initial;
  const setAnswers = vi.fn((update: (prev: Record<number, string>) => Record<number, string>) => {
    answers = update(answers);
    rerender(<RoadmapQuestions questions={QUESTIONS} answers={answers} setAnswers={setAnswers} />);
  });
  const { rerender } = render(
    <RoadmapQuestions questions={QUESTIONS} answers={answers} setAnswers={setAnswers} />,
  );
  return {
    get answers() {
      return answers;
    },
  };
}

/** Questions currently open for answering, by their text. */
const openQuestions = () =>
  Array.from(document.querySelectorAll('[data-roadmap-question]')).map(
    (el) => el.getAttribute('data-roadmap-question') ?? '',
  );

/** The one-line summaries of what has been decided. */
const decided = () =>
  Array.from(document.querySelectorAll('[data-roadmap-answered]')).map(
    (el) => el.getAttribute('data-roadmap-answered') ?? '',
  );

/**
 * What the summary line for a question currently reads as.
 *
 * Asserted on the line itself rather than by text match: the answers here
 * are substrings of the questions they answer, so a document-wide search
 * finds the question too and would pass whatever the line said.
 */
const decidedText = (question: string) =>
  document.querySelector(`[data-roadmap-answered="${question}"]`)?.textContent ?? '';

describe('asking one at a time', () => {
  it('opens only the first question', () => {
    open();
    expect(openQuestions()).toEqual(['現職を続けながら活動しますか']);
    expect(screen.queryByText('希望の業種は')).toBeNull();
  });

  it('moves to the next one as soon as the first is answered', () => {
    open();
    fireEvent.click(screen.getByText('退職して集中'));
    expect(openQuestions()).toEqual(['希望の業種は']);
  });

  it('keeps what was decided as one line each', () => {
    open();
    fireEvent.click(screen.getByText('退職して集中'));
    expect(decided()).toEqual(['現職を続けながら活動しますか']);
    expect(decidedText('現職を続けながら活動しますか')).toContain('退職して集中');
  });

  it('lets a decision be reopened and changed', () => {
    // Compact must not mean final: the answer drives the plan, and noticing
    // the wrong one two questions later is the normal case.
    open();
    fireEvent.click(screen.getByText('退職して集中'));
    fireEvent.click(screen.getByText(/現職を続けながら活動しますか/));
    expect(openQuestions()).toEqual(['現職を続けながら活動しますか']);
    fireEvent.click(screen.getByText('続けながら'));
    expect(decided()).toEqual(['現職を続けながら活動しますか']);
    expect(decidedText('現職を続けながら活動しますか')).toContain('続けながら');
  });

  it('says how far through it is', () => {
    open();
    expect(screen.getByText('rapiAvatar.roadmap.progress:1/3')).toBeTruthy();
  });

  it('closes the last one and leaves only the decisions', () => {
    // Stepped through rather than pre-filled: every question arrives with
    // its recommendation already selected, so "has an answer" cannot be what
    // decides this — only the user choosing can.
    open();
    fireEvent.click(screen.getByText('退職して集中'));
    fireEvent.click(screen.getByText('SaaS'));
    fireEvent.click(screen.getByText('首都圏'));
    expect(openQuestions()).toEqual([]);
    expect(decided()).toHaveLength(3);
  });

  it('opens the first question even when every answer is pre-selected', () => {
    // The recommendation is pre-selected on arrival. Treating that as
    // answered would open nothing at all and hide the whole interview.
    open({ 0: '続けながら', 1: 'SaaS', 2: '首都圏' });
    expect(openQuestions()).toEqual(['現職を続けながら活動しますか']);
  });

  it('shows why she would pick one, on the question being asked', () => {
    open();
    expect(screen.getByText('収入が途切れないため')).toBeTruthy();
  });

  it('draws nothing at all when there is nothing to ask', () => {
    render(<RoadmapQuestions questions={[]} answers={{}} setAnswers={vi.fn()} />);
    expect(openQuestions()).toEqual([]);
    expect(decided()).toEqual([]);
  });
});
