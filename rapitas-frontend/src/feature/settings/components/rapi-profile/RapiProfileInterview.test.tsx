/**
 * RapiProfileInterview.test
 *
 * ラピ asking who you are, so the introduction is not an empty box.
 *
 * Two things here would quietly make the feature a lie, and they are what
 * these tests hold down. The first: a round that is not handed the previous
 * answers cannot go deeper — it can only ask the opening questions again,
 * and the user would answer eight questions to get four questions' worth of
 * introduction. That is the defect the roadmap interview shipped with once.
 *
 * The second: the draft must not reach the boxes on its own. The user may
 * have written a paragraph by hand, and applying over it is their decision —
 * replacing or appending, and only when they say so.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RapiProfileInterview from './RapiProfileInterview';

// Namespace-aware, so an assertion names the key the component actually
// asks for rather than the tail of it.
vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, vals?: Record<string, unknown>) => {
    const full = namespace ? `${namespace}.${key}` : key;
    return vals ? `${full}:${Object.values(vals).join('/')}` : full;
  },
}));

/** Every request the interview made, newest last. */
let requests: { url: string; body: Record<string, unknown> }[] = [];
/** What POST /assistant/profile/questions answers with, per call. */
let rounds: unknown[] = [];
/** What POST /assistant/profile/compose answers with. */
let composed: unknown = {
  success: true,
  available: true,
  draft: { profile: '30代のエンジニア。', character: '納得してから動きたい。' },
};

const QUESTION = {
  question: '普段どんな仕事をしていますか',
  options: ['エンジニア', '企画・営業'],
  recommended: 'エンジニア',
  recommendedReason: '一番多いためです',
};
const DEEPER = {
  question: 'その仕事はいつから',
  options: ['3年未満', '10年以上'],
  recommended: '10年以上',
};

const round = (questions: unknown[]) => ({
  success: true,
  available: true,
  questions,
  maxRounds: 2,
});

/** What the card would do with an applied draft. */
let applied: { draft: unknown; mode: string }[] = [];

beforeEach(() => {
  requests = [];
  applied = [];
  rounds = [round([QUESTION]), round([DEEPER])];
  composed = {
    success: true,
    available: true,
    draft: { profile: '30代のエンジニア。', character: '納得してから動きたい。' },
  };
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    requests.push({ url: String(url), body });
    const payload = url.endsWith('/compose') ? composed : (rounds.shift() ?? round([]));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const interview = (over: Partial<{ profile: string; character: string }> = {}) =>
  render(
    <RapiProfileInterview
      profile={over.profile ?? ''}
      character={over.character ?? ''}
      onApply={(draft, mode) => applied.push({ draft, mode })}
    />,
  );

const key = (name: string) => `settings.rapiProfile.interview.${name}`;
const button = (name: string) => screen.getByRole('button', { name: key(name) });
const asksFor = (what: string) => requests.filter((r) => r.url.endsWith(what));

const startAndWait = async () => {
  fireEvent.click(button('start'));
  await waitFor(() => screen.getByText(QUESTION.question));
};

describe('the first round', () => {
  test('asks ラピ for questions, carrying what the boxes already say', async () => {
    interview({ profile: '医療事務を10年', character: '締切があると動ける' });
    await startAndWait();
    expect(asksFor('/questions')).toHaveLength(1);
    expect(asksFor('/questions')[0].body).toEqual({
      profile: '医療事務を10年',
      character: '締切があると動ける',
    });
  });

  test('shows the question with its options', async () => {
    interview();
    await startAndWait();
    expect(screen.getByText(QUESTION.options[0])).toBeInTheDocument();
    expect(screen.getByText(QUESTION.options[1])).toBeInTheDocument();
  });

  test('says so when ラピ could not be reached', async () => {
    rounds = [{ success: true, available: false }];
    interview();
    fireEvent.click(button('start'));
    await waitFor(() => expect(screen.getByText(key('unavailable'))).toBeInTheDocument());
  });
});

describe('going deeper', () => {
  test('hands every answer of the round back, so the next one can build on it', async () => {
    interview();
    await startAndWait();
    fireEvent.click(screen.getByText('企画・営業'));
    fireEvent.click(button('deeper'));
    await waitFor(() => screen.getByText(DEEPER.question));

    const second = asksFor('/questions')[1].body;
    expect(second.answers).toEqual([{ question: QUESTION.question, answer: '企画・営業' }]);
  });

  test('an untouched question still answers, with what she recommended', async () => {
    // Every question arrives with its recommendation selected, so a user who
    // agrees with all of them presses straight on. Dropping those would send
    // an empty round and read as "they said nothing".
    interview();
    await startAndWait();
    fireEvent.click(button('deeper'));
    await waitFor(() => screen.getByText(DEEPER.question));
    expect(asksFor('/questions')[1].body.answers).toEqual([
      { question: QUESTION.question, answer: QUESTION.recommended },
    ]);
  });

  test('stops offering another round once the limit is reached', async () => {
    interview();
    await startAndWait();
    fireEvent.click(button('deeper'));
    await waitFor(() => screen.getByText(DEEPER.question));
    // maxRounds is 2 and two rounds have been asked.
    expect(screen.queryByRole('button', { name: key('deeper') })).toBeNull();
  });
});

describe('the draft', () => {
  const compose = async () => {
    await startAndWait();
    fireEvent.click(button('compose'));
    await waitFor(() => screen.getByText('30代のエンジニア。'));
  };

  test('is written from every answer collected so far', async () => {
    interview();
    await startAndWait();
    fireEvent.click(button('deeper'));
    await waitFor(() => screen.getByText(DEEPER.question));
    fireEvent.click(button('compose'));
    await waitFor(() => screen.getByText('30代のエンジニア。'));

    expect(asksFor('/compose')[0].body.answers).toEqual([
      { question: QUESTION.question, answer: QUESTION.recommended },
      { question: DEEPER.question, answer: DEEPER.recommended },
    ]);
  });

  test('is shown, and nothing is applied until the user says so', async () => {
    interview();
    await compose();
    expect(applied).toEqual([]);
  });

  test('replaces the boxes when asked to', async () => {
    interview();
    await compose();
    fireEvent.click(button('replace'));
    expect(applied).toEqual([
      {
        draft: { profile: '30代のエンジニア。', character: '納得してから動きたい。' },
        mode: 'replace',
      },
    ]);
  });

  test('appends instead when asked to', async () => {
    interview();
    await compose();
    fireEvent.click(button('append'));
    expect(applied[0].mode).toBe('append');
  });

  test('says so when nothing usable came back', async () => {
    composed = { success: true, available: false };
    interview();
    await startAndWait();
    fireEvent.click(button('compose'));
    await waitFor(() => expect(screen.getByText(key('unavailable'))).toBeInTheDocument());
  });
});
