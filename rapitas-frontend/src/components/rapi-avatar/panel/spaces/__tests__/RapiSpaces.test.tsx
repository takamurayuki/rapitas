/**
 * RapiSpaces.test
 *
 * ラピ's conversations on the web live in the mobile app's spaces
 * (`/rapi-chat/spaces`), so the desktop and the phone read the same history
 * (asked 2026-11-14). Run against a small in-memory stand-in for the server,
 * shaped like `rapitas-backend/routes/ai/rapi-chat-spaces.routes.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${ns}.${key}:${Object.values(vals).join(',')}` : `${ns}.${key}`,
}));

vi.mock('../../../intake', () => ({
  TaskWatch: () => null,
  TaskIntake: () => <div data-testid="card-create" />,
  TaskAsk: () => null,
  TaskConsult: () => null,
  TaskTidy: () => null,
  TaskRoadmap: () => null,
  taskIdFromLocation: () => null,
}));
vi.mock('../../../intake/change', () => ({ TaskChange: () => null }));

import { RapiAvatarPanel } from '../../RapiAvatarPanel';
import { OPEN_SPACE_KEY } from '../useRapiSpaces';

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

interface Row {
  clientId: string;
  role: string;
  kind: string;
  text: string;
  inHistory: boolean;
  payload: string | null;
}
interface Space {
  id: number;
  title: string | null;
  rows: Row[];
  clientKey?: string;
}

/** The stand-in server. */
let server: { spaces: Space[]; nextId: number; posts: number };
/** Where a sentence is routed. */
let routeTo: string | null;
/** When set, reading a space's messages waits for it. */
let holdLoad: Promise<void> | null;

const ok = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

beforeEach(() => {
  window.localStorage.clear();
  routeTo = null;
  holdLoad = null;
  server = {
    nextId: 10,
    posts: 0,
    spaces: [
      {
        id: 5,
        title: '英語の計画',
        rows: [
          {
            clientId: 'm1',
            role: 'user',
            kind: 'text',
            text: '英語を続けたい',
            inHistory: true,
            payload: null,
          },
          {
            clientId: 'm2',
            role: 'assistant',
            kind: 'roadmap',
            text: '計画を立てました',
            inHistory: false,
            payload: '{"v":1,"kind":"roadmap","roadmap":{}}',
          },
        ],
      },
    ],
  };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (u.includes('/assistant/route')) {
      return ok(routeTo ? { routed: true, intent: routeTo, reason: '' } : { routed: false });
    }
    if (u.includes('/copilot/chat')) return ok({ success: true, content: 'はい' });
    if (u.endsWith('/rapi-chat/spaces') && method === 'GET') {
      return ok({
        success: true,
        spaces: server.spaces.map((s) => ({
          id: s.id,
          title: s.title,
          messageCount: s.rows.length,
          lastMessageAt: null,
          createdAt: '2026-11-14T00:00:00.000Z',
        })),
      });
    }
    if (u.endsWith('/rapi-chat/spaces') && method === 'POST') {
      server.posts++;
      const s: Space = { id: server.nextId++, title: null, rows: [], clientKey: body.clientKey };
      server.spaces.unshift(s);
      return ok(
        {
          success: true,
          space: { id: s.id, title: null, messageCount: 0, lastMessageAt: null, createdAt: '' },
        },
        201,
      );
    }
    const m = /\/rapi-chat\/spaces\/(\d+)\/messages/.exec(u);
    if (m) {
      const space = server.spaces.find((s) => s.id === Number(m[1]));
      if (!space) return ok({ success: false, error: 'not_found' }, 404);
      if (method === 'GET') {
        const snapshot = [...space.rows];
        if (holdLoad) await holdLoad;
        return ok({ success: true, messages: snapshot, hasMore: false });
      }
      for (const item of body.messages as Row[]) {
        const i = space.rows.findIndex((r) => r.clientId === item.clientId);
        if (i >= 0) space.rows[i] = { ...item, payload: null };
        else space.rows.push({ ...item, payload: null });
      }
      // Named after the first user line, as the server does.
      if (space.title === null) {
        const first = space.rows.find((r) => r.role === 'user');
        if (first) space.title = first.text.slice(0, 20);
      }
      return ok({ success: true, space: { title: space.title } });
    }
    throw new Error(`unexpected ${method} ${u}`);
  });
});
afterEach(() => vi.unstubAllGlobals());

const box = () => screen.getByLabelText('rapiAvatar.prompt.label') as HTMLTextAreaElement;
const say = (what: string) => {
  fireEvent.change(box(), { target: { value: what } });
  fireEvent.keyDown(box(), { key: 'Enter', shiftKey: false });
};
const title = () => document.querySelector('[data-rapi-space-title]')?.textContent;
const openList = () =>
  fireEvent.click(document.querySelector('[data-rapi-space-title]') as HTMLElement);

describe('the title at the top', () => {
  it('reads 「新しい会話」 before anything is said', () => {
    render(<RapiAvatarPanel {...props} />);
    expect(title()).toBe('rapiAvatar.spaces.untitled');
  });

  it('takes the name the server gives the conversation from its first line', async () => {
    render(<RapiAvatarPanel {...props} />);
    say('牛乳を買う');
    await waitFor(() => expect(title()).toBe('牛乳を買う'));
  });
});

describe('saving to the shared spaces', () => {
  it('creates the space on the first line, not on opening', async () => {
    render(<RapiAvatarPanel {...props} />);
    await waitFor(() => expect(screen.getByText('rapiAvatar.greeting')).toBeTruthy());
    expect(server.posts).toBe(0);
    say('こんにちは');
    await waitFor(() => expect(server.posts).toBe(1));
  });

  it('saves what was said and the answer, but never her greeting', async () => {
    render(<RapiAvatarPanel {...props} />);
    say('こんにちは');
    await waitFor(() => expect(server.spaces[0].rows).toHaveLength(2));
    expect(server.spaces[0].rows.map((r) => [r.role, r.kind, r.text, r.inHistory])).toEqual([
      ['user', 'text', 'こんにちは', true],
      ['assistant', 'text', 'はい', true],
    ]);
  });

  it('keeps saving to the same space, once created', async () => {
    render(<RapiAvatarPanel {...props} />);
    say('一つ目');
    await waitFor(() => expect(server.spaces[0].rows).toHaveLength(2));
    say('二つ目');
    await waitFor(() => expect(server.spaces[0].rows).toHaveLength(4));
    expect(server.posts).toBe(1);
  });

  it('saves a routed request as its note', async () => {
    routeTo = 'create';
    render(<RapiAvatarPanel {...props} />);
    say('牛乳を買う');
    await waitFor(() => expect(server.spaces[0].rows).toHaveLength(2));
    expect(server.spaces[0].rows[1]).toMatchObject({
      role: 'system',
      kind: 'text',
      text: 'rapiAvatar.prompt.tookItAs:rapiAvatar.mode.create,',
    });
  });

  it('remembers which conversation was open', async () => {
    render(<RapiAvatarPanel {...props} />);
    say('こんにちは');
    await waitFor(() => expect(window.localStorage.getItem(OPEN_SPACE_KEY)).toBe('10'));
  });
});

describe('switching', () => {
  it('lists the spaces, including ones started on the phone', async () => {
    render(<RapiAvatarPanel {...props} />);
    openList();
    const list = await screen.findByRole('listbox');
    await waitFor(() => expect(within(list).getByText('英語の計画')).toBeTruthy());
  });

  it('opens a picked space with what was said there', async () => {
    render(<RapiAvatarPanel {...props} />);
    openList();
    fireEvent.click(await screen.findByText('英語の計画'));
    await waitFor(() => expect(screen.getByText('英語を続けたい')).toBeTruthy());
    expect(title()).toBe('英語の計画');
  });

  // The phone's cards are snapshots; the web shows them as records.
  it('shows a card the phone saved as a record, with its text', async () => {
    render(<RapiAvatarPanel {...props} />);
    openList();
    fireEvent.click(await screen.findByText('英語の計画'));
    const card = await waitFor(() => {
      const el = document.querySelector('[data-rapi-archived="roadmap"]');
      if (!el) throw new Error('no record yet');
      return el;
    });
    expect(card.textContent).toContain('計画を立てました');
  });

  it('answers in the opened space with its earlier turns as history', async () => {
    const bodies: unknown[] = [];
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).includes('/copilot/chat')) bodies.push(JSON.parse(String(init?.body)));
      return base(url, init);
    });
    render(<RapiAvatarPanel {...props} />);
    openList();
    fireEvent.click(await screen.findByText('英語の計画'));
    await waitFor(() => expect(screen.getByText('英語を続けたい')).toBeTruthy());
    say('続きを話そう');
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect((bodies[0] as { conversationHistory: unknown[] }).conversationHistory).toEqual([
      { role: 'user', content: '英語を続けたい' },
    ]);
    await waitFor(() => expect(server.spaces.find((s) => s.id === 5)?.rows).toHaveLength(4));
  });

  it('starts a new conversation that gets its own space', async () => {
    window.localStorage.setItem(OPEN_SPACE_KEY, '5');
    render(<RapiAvatarPanel {...props} />);
    await waitFor(() => expect(screen.getByText('英語を続けたい')).toBeTruthy());
    fireEvent.click(screen.getAllByLabelText('rapiAvatar.spaces.startNew')[0]);
    expect(screen.queryByText('英語を続けたい')).toBeNull();
    expect(title()).toBe('rapiAvatar.spaces.untitled');
    say('別の話');
    await waitFor(() => expect(server.posts).toBe(1));
    expect(server.spaces.find((s) => s.id === 5)?.rows).toHaveLength(2);
  });
});

describe('coming back', () => {
  it('reopens the conversation left open last time', async () => {
    window.localStorage.setItem(OPEN_SPACE_KEY, '5');
    render(<RapiAvatarPanel {...props} />);
    await waitFor(() => expect(screen.getByText('英語を続けたい')).toBeTruthy());
    expect(title()).toBe('英語の計画');
  });

  // The history can arrive after the first sentence was already sent. It is
  // put in front of it, and nothing on its way is called off.
  it('keeps a sentence sent before the history arrived, in the same space', async () => {
    let release = () => {};
    holdLoad = new Promise((r) => (release = r));
    window.localStorage.setItem(OPEN_SPACE_KEY, '5');
    render(<RapiAvatarPanel {...props} />);
    say('待てずに話す');
    await waitFor(() => expect(screen.getByText('はい')).toBeTruthy());
    release();
    await waitFor(() => expect(screen.getByText('英語を続けたい')).toBeTruthy());
    const texts = Array.from(document.querySelectorAll('[data-rapi-line="user"]')).map(
      (e) => e.textContent,
    );
    expect(texts).toEqual(['英語を続けたい', '待てずに話す']);
    expect(server.posts).toBe(0);
    expect(server.spaces.find((s) => s.id === 5)?.rows.map((r) => r.text)).toContain(
      '待てずに話す',
    );
  });

  it('starts fresh when that conversation was deleted on the other device', async () => {
    window.localStorage.setItem(OPEN_SPACE_KEY, '99');
    render(<RapiAvatarPanel {...props} />);
    await waitFor(() => expect(window.localStorage.getItem(OPEN_SPACE_KEY)).toBeNull());
    expect(title()).toBe('rapiAvatar.spaces.untitled');
  });
});
