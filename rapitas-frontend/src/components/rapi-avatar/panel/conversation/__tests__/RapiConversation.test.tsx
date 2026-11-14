/**
 * RapiConversation.test
 *
 * Talking to ラピ, end to end through the panel: the sentence joins the
 * thread at once, a request for one of her modes is answered with a note
 * and that mode's card, and anything else gets a reply in words — the way
 * the mobile app answers the same sentence (asked 2026-11-14).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let pathname = '/dashboard';
let search = '';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${ns}.${key}:${Object.values(vals).join(',')}` : `${ns}.${key}`,
}));

/** Each card marks itself with the sentence it was handed. */
vi.mock('../../../intake', () => ({
  TaskWatch: () => <div data-testid="card-watch" />,
  TaskIntake: ({ handedOver }: { handedOver?: string }) => (
    <div data-testid="card-create">{handedOver}</div>
  ),
  TaskAsk: ({ handedOver }: { handedOver?: string }) => (
    <div data-testid="card-ask">{handedOver}</div>
  ),
  TaskConsult: () => <div data-testid="card-consult" />,
  TaskTidy: () => <div data-testid="card-tidy" />,
  TaskRoadmap: ({ handedOver }: { handedOver?: string }) => (
    <div data-testid="card-roadmap">{handedOver}</div>
  ),
  taskIdFromLocation: (path: string, panel: string | null) =>
    path.startsWith('/tasks/') || panel ? 42 : null,
}));
vi.mock('../../../intake/change', () => ({
  TaskChange: ({ handedOver }: { handedOver?: string }) => (
    <div data-testid="card-change">{handedOver}</div>
  ),
}));

import { RapiAvatarPanel } from '../../RapiAvatarPanel';

const props = {
  executions: [],
  resumingIds: new Set<number>(),
  dismissingIds: new Set<number>(),
  runningCount: 0,
  interruptedCount: 0,
  onResume: vi.fn(),
  onResumeAll: vi.fn(),
  onDismiss: vi.fn(),
  formatTimeAgo: () => '',
  onClose: vi.fn(),
  placement: {
    side: 'above' as const,
    right: 24,
    bottom: 100,
    width: 448,
    tailOffsetPx: 34,
    maxHeightPx: 700,
  },
  dark: false,
  open: true,
};

interface Call {
  url: string;
  body: Record<string, unknown>;
}
let calls: Call[] = [];
/** What the router and the chat answer; a function so a test can hold one. */
let answer: (url: string) => Promise<{ ok: boolean; status: number; body: unknown }>;

beforeEach(() => {
  pathname = '/dashboard';
  search = '';
  calls = [];
  answer = async (url) =>
    url.includes('/assistant/route')
      ? { ok: true, status: 200, body: { routed: false } }
      : { ok: true, status: 200, body: { success: true, content: 'こんにちは' } };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const a = await answer(String(url));
    if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return { ok: a.ok, status: a.status, json: async () => a.body } as Response;
  });
});
afterEach(() => vi.unstubAllGlobals());

const box = () => screen.getByLabelText('rapiAvatar.prompt.label') as HTMLTextAreaElement;
const say = (what: string) => {
  fireEvent.change(box(), { target: { value: what } });
  fireEvent.keyDown(box(), { key: 'Enter', shiftKey: false });
};
const lines = (role: string) =>
  Array.from(document.querySelectorAll(`[data-rapi-line="${role}"]`)).map((e) => e.textContent);

describe('opening', () => {
  // Asked 2026-11-14: the greeting reads as a message from her, not as a
  // caption above the conversation.
  it('starts with her greeting as her first message', () => {
    render(<RapiAvatarPanel {...props} />);
    expect(lines('assistant')).toEqual(['rapiAvatar.greeting']);
  });

  it('offers no tabs and no example list to choose from', () => {
    render(<RapiAvatarPanel {...props} />);
    expect(document.querySelectorAll('[data-rapi-mode-tab]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-rapi-example]')).toHaveLength(0);
  });
});

describe('talking', () => {
  it('puts what you said in the thread at once and empties the box', () => {
    answer = () => new Promise(() => {});
    render(<RapiAvatarPanel {...props} />);
    say('こんにちは');
    expect(lines('user')).toEqual(['こんにちは']);
    expect(box().value).toBe('');
    expect(document.querySelector('[data-rapi-typing]')).not.toBeNull();
  });

  // What the mobile app does with an unrouted sentence, in place of the
  // old "I could not tell, pick a tab".
  it('answers in words when it is not a request for one of her modes', async () => {
    render(<RapiAvatarPanel {...props} />);
    say('元気？');
    await waitFor(() => expect(lines('assistant')).toEqual(['rapiAvatar.greeting', 'こんにちは']));
    const chat = calls.find((c) => c.url.includes('/copilot/chat'));
    expect(chat?.body).toMatchObject({ message: '元気？', taskId: null });
  });

  it('sends what was said before, without her greeting', async () => {
    render(<RapiAvatarPanel {...props} />);
    say('元気？');
    await waitFor(() => expect(lines('assistant')).toHaveLength(2));
    say('ほんとに？');
    await waitFor(() => expect(lines('assistant')).toHaveLength(3));
    const second = calls.filter((c) => c.url.includes('/copilot/chat'))[1];
    expect(second.body.conversationHistory).toEqual([
      { role: 'user', content: '元気？' },
      { role: 'assistant', content: 'こんにちは' },
    ]);
  });

  it('answers a request with where it went and that mode, handed the sentence', async () => {
    answer = async (url) =>
      url.includes('/assistant/route')
        ? { ok: true, status: 200, body: { routed: true, intent: 'ask', reason: '件数のため' } }
        : { ok: true, status: 200, body: {} };
    render(<RapiAvatarPanel {...props} />);
    say('期限切れは何件？');
    await waitFor(() =>
      expect(screen.getByTestId('card-ask').textContent).toBe('期限切れは何件？'),
    );
    expect(
      screen.getByText('rapiAvatar.prompt.tookItAs:rapiAvatar.mode.ask,件数のため'),
    ).toBeTruthy();
    expect(calls.some((c) => c.url.includes('/copilot/chat'))).toBe(false);
  });

  // Each answer stays where it came in, so a second request of the same
  // kind gets its own card instead of replacing the first.
  it('keeps earlier answers in the thread', async () => {
    answer = async (url) =>
      url.includes('/assistant/route')
        ? { ok: true, status: 200, body: { routed: true, intent: 'create', reason: '' } }
        : { ok: true, status: 200, body: {} };
    render(<RapiAvatarPanel {...props} />);
    say('牛乳を買う');
    await waitFor(() => expect(screen.getAllByTestId('card-create')).toHaveLength(1));
    say('卵を買う');
    await waitFor(() => expect(screen.getAllByTestId('card-create')).toHaveLength(2));
    expect(screen.getAllByTestId('card-create').map((e) => e.textContent)).toEqual([
      '牛乳を買う',
      '卵を買う',
    ]);
  });

  it('can think a request over as a plan instead', async () => {
    answer = async (url) =>
      url.includes('/assistant/route')
        ? { ok: true, status: 200, body: { routed: true, intent: 'create', reason: '' } }
        : { ok: true, status: 200, body: {} };
    render(<RapiAvatarPanel {...props} />);
    say('英語を毎日続けたい');
    await waitFor(() => expect(screen.getByTestId('card-create')).toBeTruthy());
    fireEvent.click(screen.getByText('rapiAvatar.prompt.ratherPlan'));
    expect(screen.getByTestId('card-roadmap').textContent).toBe('英語を毎日続けたい');
  });

  it.each([
    ['off a task', '/dashboard', '', false],
    ['on the task page', '/tasks/42', '', true],
    ['on the slide panel', '/', 'panel=42', true],
  ])('tells the router whether a task is open (%s)', async (_l, path, query, expected) => {
    pathname = path;
    search = query;
    render(<RapiAvatarPanel {...props} />);
    say('このタスクについて');
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].body.hasOpenTask).toBe(expected);
  });
});

describe('when it does not go through', () => {
  it('says so and gives the sentence back', async () => {
    answer = async () => ({ ok: false, status: 500, body: {} });
    render(<RapiAvatarPanel {...props} />);
    say('こんにちは');
    await waitFor(() => expect(lines('system')).toEqual(['rapiAvatar.prompt.failed']));
    expect(box().value).toBe('こんにちは');
  });

  it('leaves a failed sentence out of what is sent next time', async () => {
    let fail = true;
    answer = async (url) =>
      fail
        ? { ok: false, status: 500, body: {} }
        : url.includes('/assistant/route')
          ? { ok: true, status: 200, body: { routed: false } }
          : { ok: true, status: 200, body: { success: true, content: 'はい' } };
    render(<RapiAvatarPanel {...props} />);
    say('一回目');
    await waitFor(() => expect(lines('system')).toHaveLength(1));
    fail = false;
    say('二回目');
    await waitFor(() => expect(lines('assistant')).toHaveLength(2));
    const chat = calls.filter((c) => c.url.includes('/copilot/chat')).pop();
    expect(chat?.body.conversationHistory).toEqual([]);
  });

  it('gives the sentence back without a failure note when called off', async () => {
    answer = () => new Promise(() => {});
    render(<RapiAvatarPanel {...props} />);
    say('やっぱりいい');
    fireEvent.click(screen.getByText('rapiAvatar.prompt.cancel'));
    await waitFor(() => expect(box().value).toBe('やっぱりいい'));
    expect(lines('system')).toEqual([]);
    expect(box().disabled).toBe(false);
  });
});
