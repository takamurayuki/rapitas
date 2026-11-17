/**
 * copilot-read-marks.test
 *
 * In the task consult chat a user line counts as read once her answer is
 * there — also when the chat is reloaded from its saved history.
 */
import { describe, it, expect } from 'vitest';
import { markRead, toHistoryMessages } from '../copilot-read-marks';

describe('toHistoryMessages', () => {
  it('marks the user lines her answer follows, not the last unanswered one', () => {
    const lines = toHistoryMessages([
      { id: 1, role: 'user', content: 'q1', createdAt: '' },
      { id: 2, role: 'assistant', content: 'a1', createdAt: '' },
      { id: 3, role: 'user', content: 'q2', createdAt: '' },
    ]);
    expect(lines.map((l) => l.readAs)).toEqual(['consult', undefined, undefined]);
  });
});

describe('markRead', () => {
  it('marks only that line', () => {
    const out = markRead(
      [
        { id: 'u1', role: 'user', content: 'a', createdAt: '' },
        { id: 'u2', role: 'user', content: 'b', createdAt: '' },
      ],
      'u2',
    );
    expect(out.map((l) => l.readAs)).toEqual([undefined, 'consult']);
  });
});
