/**
 * RapiProfileCard.test
 *
 * The standing self-introduction ラピ plans against.
 *
 * Asked for 2026-10-22: the roadmap interview asks who you are before it
 * can plan, and asks again next time. Writing it once here answers it for
 * every roadmap.
 *
 * What the tests hold down is the part that would quietly lose work: the
 * card is a text box the user types a paragraph into, so a save that failed
 * must say so rather than look saved, and a reload must show what is
 * actually stored rather than what was typed.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RapiProfileCard from './RapiProfileCard';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${key}:${Object.values(vals).join('/')}` : key,
}));

/** Requests the card made. */
let requests: { method: string; body: unknown }[] = [];
/** What GET /settings answers with. */
let stored: string | null = null;
let storedCharacter: string | null = null;
/** Whether PATCH should fail. */
let patchFails = false;

beforeEach(() => {
  requests = [];
  stored = null;
  storedCharacter = null;
  patchFails = false;
  vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    requests.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'PATCH') {
      if (patchFails) return Promise.resolve({ ok: false, status: 500 } as Response);
      const body = JSON.parse(String(init?.body)) as {
        rapiProfile: string;
        rapiCharacter: string;
      };
      stored = body.rapiProfile;
      storedCharacter = body.rapiCharacter;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ rapiProfile: stored, rapiCharacter: storedCharacter }),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ rapiProfile: stored, rapiCharacter: storedCharacter }),
    } as Response);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const boxes = () => screen.getAllByRole('textbox') as HTMLTextAreaElement[];
/** The facts half. */
const box = () => boxes()[0];
/** The character half. */
const characterBox = () => boxes()[1];
const saves = () => requests.filter((r) => r.method === 'PATCH');

describe('what it shows', () => {
  it('loads what is already stored', async () => {
    stored = '30代のソフトウェアエンジニア。';
    render(<RapiProfileCard />);
    await waitFor(() => expect(box().value).toBe('30代のソフトウェアエンジニア。'));
  });

  it('starts empty when nothing has been written', async () => {
    render(<RapiProfileCard />);
    await waitFor(() => expect(box()).toBeTruthy());
    expect(box().value).toBe('');
  });

  it('says how much room is left', async () => {
    // It rides in front of every roadmap request, so the budget is real and
    // worth showing before the text is silently cut.
    render(<RapiProfileCard />);
    await waitFor(() => expect(box()).toBeTruthy());
    fireEvent.change(box(), { target: { value: 'あいう' } });
    expect(screen.getByText(/3\/1200/)).toBeTruthy();
  });
});

describe('saving it', () => {
  it('sends what was typed', async () => {
    render(<RapiProfileCard />);
    await waitFor(() => expect(box()).toBeTruthy());
    fireEvent.change(box(), { target: { value: '平日夜と土日しか動けない。' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0]?.body).toEqual({
      rapiProfile: '平日夜と土日しか動けない。',
      rapiCharacter: '',
    });
  });

  it('can clear it', async () => {
    stored = '古い自己紹介';
    render(<RapiProfileCard />);
    await waitFor(() => expect(box().value).toBe('古い自己紹介'));
    fireEvent.change(box(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0]?.body).toEqual({ rapiProfile: '', rapiCharacter: '' });
  });

  it('says it saved', async () => {
    render(<RapiProfileCard />);
    await waitFor(() => expect(box()).toBeTruthy());
    fireEvent.change(box(), { target: { value: '書いた' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(screen.getByText('settings.rapiProfile.saved')).toBeTruthy());
  });

  it('says it did not save rather than looking saved', async () => {
    // Looking saved when it is not is how a profile silently stops being
    // the one ラピ is planning against.
    patchFails = true;
    render(<RapiProfileCard />);
    await waitFor(() => expect(box()).toBeTruthy());
    fireEvent.change(box(), { target: { value: '書いた' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(screen.getByText('settings.rapiProfile.saveFailed')).toBeTruthy());
    expect(screen.queryByText('settings.rapiProfile.saved')).toBeNull();
  });

  it('does not save what has not changed', async () => {
    stored = '同じ文';
    render(<RapiProfileCard />);
    await waitFor(() => expect(box().value).toBe('同じ文'));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(saves()).toHaveLength(0);
  });
});

describe('the character half', () => {
  it('loads what is already stored', async () => {
    storedCharacter = '納得してから動きたい。';
    render(<RapiProfileCard />);
    await waitFor(() => expect(characterBox().value).toBe('納得してから動きたい。'));
  });

  it('is saved alongside the facts, not instead of them', async () => {
    // PATCH writes only the keys it is given, so sending one half would
    // leave the other showing an edit that was never stored.
    stored = 'エンジニア8年';
    render(<RapiProfileCard />);
    await waitFor(() => expect(box().value).toBe('エンジニア8年'));
    fireEvent.change(characterBox(), { target: { value: '納得してから動きたい' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0]?.body).toEqual({
      rapiProfile: 'エンジニア8年',
      rapiCharacter: '納得してから動きたい',
    });
  });

  it('counts as a change on its own', async () => {
    // Editing only this half must still enable the button, or the half
    // that decides whether a plan is the right one cannot be edited at all.
    render(<RapiProfileCard />);
    await waitFor(() => expect(characterBox()).toBeTruthy());
    fireEvent.change(characterBox(), { target: { value: '納得してから動きたい' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(saves()).toHaveLength(1));
  });
});
