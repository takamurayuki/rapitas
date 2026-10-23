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
/** Whether PATCH should fail. */
let patchFails = false;

beforeEach(() => {
  requests = [];
  stored = null;
  patchFails = false;
  vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    requests.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'PATCH') {
      if (patchFails) return Promise.resolve({ ok: false, status: 500 } as Response);
      stored = (JSON.parse(String(init?.body)) as { rapiProfile: string }).rapiProfile;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ rapiProfile: stored }),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ rapiProfile: stored }),
    } as Response);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;
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
    expect(saves()[0]?.body).toEqual({ rapiProfile: '平日夜と土日しか動けない。' });
  });

  it('can clear it', async () => {
    stored = '古い自己紹介';
    render(<RapiProfileCard />);
    await waitFor(() => expect(box().value).toBe('古い自己紹介'));
    fireEvent.change(box(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0]?.body).toEqual({ rapiProfile: '' });
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
