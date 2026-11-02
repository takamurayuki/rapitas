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

describe('while she is reading it', () => {
  /** Held open so the request is still in flight during the assertions. */
  let release: (() => void) | null = null;

  const hold = () =>
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init?.body)) });
      return new Promise((resolve, reject) => {
        release = () =>
          resolve({ ok: true, status: 200, json: () => Promise.resolve(answer) } as Response);
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    });

  afterEach(() => {
    release = null;
  });

  // Editing a sentence that has already gone is editing nothing: what comes
  // back was routed on what was sent, so a box you can still type into is
  // telling you otherwise.
  it('will not let the sentence be edited once it has gone', async () => {
    hold();
    mount();
    type('ブロックは何件？');
    enter();
    await waitFor(() => expect(requests).toHaveLength(1));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('offers a way out while it waits', async () => {
    hold();
    mount();
    type('ブロックは何件？');
    enter();
    await waitFor(() => expect(screen.getByText('rapiAvatar.prompt.cancel')).toBeTruthy());
  });

  // The point of cancelling: the request stops, rather than landing later
  // and dragging the user somewhere they have moved on from.
  it('drops the answer when cancelled', async () => {
    hold();
    mount();
    type('ブロックは何件？');
    enter();
    await waitFor(() => expect(screen.getByText('rapiAvatar.prompt.cancel')).toBeTruthy());

    fireEvent.click(screen.getByText('rapiAvatar.prompt.cancel'));
    release!();
    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false),
    );
    expect(routed).toEqual([]);
  });

  it('gives the sentence back to be reworded after cancelling', async () => {
    hold();
    mount();
    type('ブロックは何件？');
    enter();
    await waitFor(() => expect(screen.getByText('rapiAvatar.prompt.cancel')).toBeTruthy());
    fireEvent.click(screen.getByText('rapiAvatar.prompt.cancel'));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('ブロックは何件？');
  });

  // A cancel is not a failure, and saying "I could not tell" about something
  // the user called off would be a lie.
  it('says nothing about not understanding', async () => {
    hold();
    mount();
    type('ブロックは何件？');
    enter();
    await waitFor(() => expect(screen.getByText('rapiAvatar.prompt.cancel')).toBeTruthy());
    fireEvent.click(screen.getByText('rapiAvatar.prompt.cancel'));
    release!();
    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false),
    );
    expect(screen.queryByText('rapiAvatar.prompt.unplaced')).toBeNull();
  });

  it('unlocks the box once the answer lands', async () => {
    hold();
    mount();
    type('ブロックは何件？');
    enter();
    await waitFor(() => expect(requests).toHaveLength(1));
    release!();
    await waitFor(() => expect(routed).toHaveLength(1));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false);
  });

  it('offers no way out when nothing is in flight', () => {
    mount();
    expect(screen.queryByText('rapiAvatar.prompt.cancel')).toBeNull();
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

describe('the size of the box', () => {
  /** jsdom lays nothing out, so the content height is supplied. */
  const withContentHeight = (px: number) => {
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    Object.defineProperty(box, 'scrollHeight', { value: px, configurable: true });
    return box;
  };

  it('starts as one line', () => {
    mount();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).rows).toBe(1);
  });

  it('grows to fit what was typed', () => {
    // It was a fixed 30px line that shrank against the list below it; two or
    // three lines of plain Japanese were never visible at once.
    mount();
    const box = withContentHeight(64);
    fireEvent.change(box, { target: { value: 'ふたつ\nみっつ' } });
    expect(box.style.height).toBe('64px');
  });

  it('stops growing before it eats the panel', () => {
    mount();
    const box = withContentHeight(400);
    fireEvent.change(box, { target: { value: 'とても長い文章' } });
    expect(box.style.height).toBe('108px');
    expect(box.style.overflowY).toBe('auto');
  });

  it('measures from scratch, or the box would only ever grow', () => {
    // The height must be released before scrollHeight is read: held taller,
    // the element reports the height it is being held at, and the box grows
    // and never shrinks. jsdom computes no layout, so a stubbed scrollHeight
    // cannot show that happening — what it can show is the release itself,
    // so every assignment is recorded instead.
    mount();
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    const assigned: string[] = [];
    Object.defineProperty(box.style, 'height', {
      configurable: true,
      get: () => assigned[assigned.length - 1] ?? '',
      set: (v: string) => {
        assigned.push(v);
      },
    });
    Object.defineProperty(box, 'scrollHeight', { value: 96, configurable: true });
    fireEvent.change(box, { target: { value: 'ながい' } });
    expect(assigned).toEqual(['auto', '96px']);
  });
});
