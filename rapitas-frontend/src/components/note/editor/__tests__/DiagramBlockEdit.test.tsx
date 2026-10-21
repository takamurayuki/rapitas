/**
 * DiagramBlockEdit.test
 *
 * The diagram editor's live preview, and the mess it used to leave behind.
 *
 * Mermaid builds each diagram in a `d<id>` element it appends to
 * document.body. On a parse error it paints "Syntax error in text" into that
 * element and throws **without removing it** — `suppressErrorRendering`
 * defaults to false. Two other callers in this repo clean it up; this one
 * did not, and it is the preview that re-renders as you type, so every
 * half-finished line left another one stacked at the end of the page.
 *
 * The mock below reproduces that exact behaviour rather than simply
 * throwing, because a mock that only throws would pass with or without the
 * fix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

/** Sources the stand-in mermaid refuses, so a test can choose to fail. */
const BAD = 'this is not a diagram';

vi.mock('mermaid', () => ({
  default: {
    initialize: () => {},
    render: async (id: string, source: string) => {
      // What the real one does: build in a detached element appended to the
      // body, and on failure paint the error into it and throw, leaving it.
      const holder = document.createElement('div');
      holder.id = `d${id}`;
      holder.textContent = 'Syntax error in text mermaid version 11.16.0';
      document.body.appendChild(holder);
      if (source.includes(BAD)) throw new Error('Parse error');
      holder.remove();
      return { svg: '<svg data-ok="true"></svg>' };
    },
  },
}));

import DiagramBlockEdit from '../DiagramBlockEdit';

/** Everything mermaid left lying at the end of the page. */
const orphans = () => Array.from(document.querySelectorAll('[id^="dmermaid-edit-"]'));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.body.querySelectorAll('[id^="dmermaid-edit-"]').forEach((n) => n.remove());
});

/** Let the 400ms debounce fire and the render promise settle. */
const settle = async () => {
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
};

const show = (source: string) =>
  render(<DiagramBlockEdit source={source} onSave={() => {}} onCancel={() => {}} />);

describe('the live preview', () => {
  it('leaves nothing behind when the source will not parse', async () => {
    show(BAD);
    await settle();
    expect(orphans()).toHaveLength(0);
  });

  // The symptom as reported: dozens of them, because the preview re-runs on
  // every pause in typing and each failure used to add one.
  it('does not stack one up per attempt while typing', async () => {
    show(BAD);
    await settle();
    const box = screen.getByRole('textbox');
    for (const attempt of [`${BAD} a`, `${BAD} ab`, `${BAD} abc`]) {
      fireEvent.change(box, { target: { value: attempt } });
      await settle();
    }
    expect(orphans()).toHaveLength(0);
  });

  it('leaves nothing behind when the source does parse either', async () => {
    show('graph TD\n A --> B');
    await settle();
    expect(orphans()).toHaveLength(0);
  });
});
