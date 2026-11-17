/**
 * RapiReadStamp.test
 *
 * The stamp means "she has read it" (nav63, same as the mobile app): it is
 * not there while the sentence is on its way, goes on when routing answers,
 * never stays on a failed send, carries the turn's glyph (🫡 / 👀 / 👌) and
 * sits on the bubble's lower-right corner.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test' }));
vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock('../../../intake', () => ({
  TaskWatch: () => null,
  TaskIntake: () => null,
  TaskAsk: () => null,
  TaskConsult: () => null,
  TaskTidy: () => null,
  TaskRoadmap: () => null,
}));
vi.mock('../../../intake/change', () => ({ TaskChange: () => null }));

import { useRapiConversation } from '../useRapiConversation';
import { RapiThread } from '../RapiThread';
import type { RapiMessage } from '../conversation-types';

type Reply = { ok: boolean; status: number; body: unknown };
let held: Array<{ url: string; resolve: (r: Reply) => void }> = [];

beforeEach(() => {
  held = [];
  global.fetch = vi.fn(
    (url: string) =>
      new Promise((resolve) => {
        held.push({
          url,
          resolve: (r: Reply) =>
            resolve({ ok: r.ok, status: r.status, json: () => Promise.resolve(r.body) }),
        });
      }),
  ) as unknown as typeof fetch;
});

/** Answers the oldest request still waiting. */
async function answer(r: Reply) {
  const next = held.shift();
  if (!next) throw new Error('nothing is waiting');
  await act(async () => {
    next.resolve(r);
    await Promise.resolve();
  });
}

function conversation() {
  const hook = renderHook(() =>
    useRapiConversation({ hasOpenTask: false, greeting: 'こんにちは', failedText: '失敗' }),
  );
  const say = async (text: string) => {
    act(() => hook.result.current.setText(text));
    await act(async () => {
      void hook.result.current.send();
      await Promise.resolve();
    });
  };
  const user = (text: string) =>
    hook.result.current.messages.find((m) => m.role === 'user' && m.text === text);
  return { hook, say, user };
}

describe('when the stamp goes on', () => {
  it('is not on while the sentence is on its way, and goes on when routing answers', async () => {
    const { say, user } = conversation();
    await say('資料づくりをタスクにして');
    expect(user('資料づくりをタスクにして')?.readAs).toBeUndefined();

    await answer({ ok: true, status: 200, body: { routed: true, intent: 'create', reason: '' } });
    expect(user('資料づくりをタスクにして')?.readAs).toBe('create');
  });

  it('goes on for a talk before her words arrive', async () => {
    const { say, user } = conversation();
    await say('こんにちは');
    await answer({ ok: true, status: 200, body: { routed: false } });
    // The chat request is still out; the sentence is read already.
    expect(held[0]?.url).toContain('/copilot/chat');
    expect(user('こんにちは')?.readAs).toBe('chat');
  });

  it('never stays on a sentence whose send failed, even after routing', async () => {
    const { say, user } = conversation();
    await say('こんにちは');
    await answer({ ok: true, status: 200, body: { routed: false } });
    expect(user('こんにちは')?.readAs).toBe('chat');
    await answer({ ok: false, status: 500, body: {} });
    expect(user('こんにちは')?.readAs).toBeUndefined();

    await say('届かない');
    await answer({ ok: false, status: 500, body: {} });
    expect(user('届かない')?.readAs).toBeUndefined();
  });
});

function line(partial: Partial<RapiMessage> & Pick<RapiMessage, 'id' | 'role' | 'text'>) {
  return { clientId: `c${partial.id}`, inHistory: true, ...partial } as RapiMessage;
}

describe('what the stamp shows', () => {
  it('draws the glyph of the intent on the lower-right corner', () => {
    render(
      <RapiThread
        sending={false}
        rethinkAsPlan={() => {}}
        messages={[
          line({ id: 1, role: 'user', text: '作って', readAs: 'create' }),
          line({ id: 2, role: 'user', text: '見守って', readAs: 'watch' }),
          line({ id: 3, role: 'user', text: '何件？', readAs: 'ask' }),
          line({ id: 4, role: 'user', text: '送信中' }),
        ]}
      />,
    );
    const glyphOf = (text: string) =>
      screen.getByText(text).closest('div.relative')?.querySelector('[data-chat-received]')
        ?.textContent ?? null;
    expect(glyphOf('作って')).toBe('🫡');
    expect(glyphOf('見守って')).toBe('👀');
    expect(glyphOf('何件？')).toBe('👌');
    expect(glyphOf('送信中')).toBeNull();
    const stamp = screen.getAllByRole('img', { name: 'copilot.chatFeel.received' })[0];
    expect(stamp.className).toContain('-right-2');
    expect(stamp.className).toContain('-bottom-2');
    expect(stamp.className).not.toContain('-left-2');
  });
});
