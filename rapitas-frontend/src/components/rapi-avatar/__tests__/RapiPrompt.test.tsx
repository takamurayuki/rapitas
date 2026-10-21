/**
 * RapiPrompt.test
 *
 * The front door. What matters is not that it routes — it is what it does
 * when it cannot.
 *
 * Every destination is a read, so a wrong turn costs a wasted look and the
 * note above the tabs makes it visible. Refusing to turn costs a click,
 * because the tabs are still there. That asymmetry is why "I could not tell"
 * has to be a real answer rather than a nearest guess, and most of these
 * tests are about holding that line.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${ns}.${key}:${Object.values(vals).join(',')}` : `${ns}.${key}`,
}));
vi.mock('@/utils/ime', () => ({ isImeComposing: () => false }));

import { RapiPrompt, type Routed } from '../RapiPrompt';

let requests: { url: string; body: Record<string, unknown> }[] = [];
let answer: Record<string, unknown> = {
  routed: true,
  intent: 'ask',
  reason: '件数を尋ねているため',
};
let ok = true;
let routed: Routed[] = [];

beforeEach(() => {
  requests = [];
  routed = [];
  ok = true;
  answer = { routed: true, intent: 'ask', reason: '件数を尋ねているため' };
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init?.body)) });
    return Promise.resolve({
      ok,
      status: ok ? 200 : 500,
      json: () => Promise.resolve(answer),
    } as Response);
  });
});

afterEach(() => vi.unstubAllGlobals());

const type = (what: string) =>
  fireEvent.change(screen.getByRole('textbox'), { target: { value: what } });
const enter = () =>
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: false });

const mount = (hasOpenTask = false) =>
  render(<RapiPrompt hasOpenTask={hasOpenTask} onRouted={(r) => routed.push(r)} />);

describe('sending a sentence', () => {
  it('hands the destination back with the sentence that caused it', async () => {
    mount();
    type('ブロックは何件？');
    enter();
    await waitFor(() => expect(routed).toHaveLength(1));
    expect(routed[0]).toEqual({
      intent: 'ask',
      reason: '件数を尋ねているため',
      text: 'ブロックは何件？',
    });
  });

  // `consult` only exists when a task is open, so the server has to be told.
  it.each([
    [true, true],
    [false, false],
  ])('tells the server whether a task is open (%s)', async (hasTask, expected) => {
    mount(hasTask);
    type('なにか');
    enter();
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body.hasOpenTask).toBe(expected);
  });

  it('clears the box once it has gone somewhere', async () => {
    mount();
    type('ブロックは何件？');
    enter();
    await waitFor(() => expect(routed).toHaveLength(1));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('sends nothing for an empty box', () => {
    mount();
    enter();
    expect(requests).toEqual([]);
  });

  // Shift+Enter is a line break, not a send.
  it('does not send on shift+enter', () => {
    mount();
    type('一行目');
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true });
    expect(requests).toEqual([]);
  });
});

describe('when she cannot tell', () => {
  // The whole point. A nearest guess sends the user somewhere they did not
  // ask for; a shrug costs one click, because the tabs are right there.
  it('says so rather than guessing a destination', async () => {
    answer = { routed: false };
    mount();
    type('うーん');
    enter();
    await waitFor(() => expect(screen.getByText('rapiAvatar.prompt.unplaced')).toBeTruthy());
    expect(routed).toEqual([]);
  });

  it('keeps what was typed, so it can be reworded rather than retyped', async () => {
    answer = { routed: false };
    mount();
    type('うーん');
    enter();
    await waitFor(() => expect(screen.getByText('rapiAvatar.prompt.unplaced')).toBeTruthy());
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('うーん');
  });

  it('says the same thing when the request itself fails', async () => {
    ok = false;
    mount();
    type('なにか');
    enter();
    await waitFor(() => expect(screen.getByText('rapiAvatar.prompt.unplaced')).toBeTruthy());
    expect(routed).toEqual([]);
  });

  // A stale "I could not tell" beside a successful route would contradict it.
  it('drops the note once something does route', async () => {
    answer = { routed: false };
    mount();
    type('うーん');
    enter();
    await waitFor(() => expect(screen.getByText('rapiAvatar.prompt.unplaced')).toBeTruthy());

    answer = { routed: true, intent: 'watch', reason: 'なんとなく' };
    type('滞ってるものは？');
    enter();
    await waitFor(() => expect(routed).toHaveLength(1));
    expect(screen.queryByText('rapiAvatar.prompt.unplaced')).toBeNull();
  });
});
