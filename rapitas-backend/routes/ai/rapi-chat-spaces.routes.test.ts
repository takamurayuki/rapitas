/**
 * rapi-chat-spaces.routes tests
 *
 * The /rapi-chat HTTP contract over a real SQLite database (design §4.2, §11.1):
 * CRUD, idempotent PUT, paging boundaries, the atomic refusals (400/422/409),
 * the JSON round trip and the cascade on delete.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  createRapiChatTestDb,
  seedMessages,
  textItem,
  type RapiChatTestDb,
} from '../../services/rapi-chat/rapi-chat.test-helpers';

mock.module('../../config/database', () => ({ prisma: {} }));
const { rapiChatSpacesRoutes, setRapiChatDbForTest } = await import('./rapi-chat-spaces.routes');

let t: RapiChatTestDb;

beforeEach(() => {
  t = createRapiChatTestDb();
  setRapiChatDbForTest(t.db);
});
afterEach(async () => {
  await t.dispose();
});

async function call(method: string, path: string, body?: unknown) {
  const res = await rapiChatSpacesRoutes.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

async function newSpace(extra: Record<string, unknown> = {}): Promise<number> {
  const r = await call('POST', '/rapi-chat/spaces', extra);
  return r.json.space.id as number;
}

describe('spaces CRUD', () => {
  it('creates, lists newest activity first, and deletes', async () => {
    const a = await newSpace();
    const b = await newSpace();
    await call('PUT', `/rapi-chat/spaces/${a}/messages`, { messages: [textItem('m1')] });
    const list = await call('GET', '/rapi-chat/spaces');
    expect(list.json.spaces.map((s: { id: number }) => s.id)).toEqual([a, b]);
    expect(list.json.spaces[0].messageCount).toBe(1);

    const del = await call('DELETE', `/rapi-chat/spaces/${a}`);
    expect(del.json).toEqual({ success: true, deletedMessages: 1 });
    expect((await call('GET', '/rapi-chat/spaces')).json.spaces).toHaveLength(1);
  });

  it('answers 404 for a missing space on every per-space route', async () => {
    expect((await call('DELETE', '/rapi-chat/spaces/999')).status).toBe(404);
    expect((await call('GET', '/rapi-chat/spaces/999/messages')).status).toBe(404);
    expect(
      (await call('PUT', '/rapi-chat/spaces/999/messages', { messages: [textItem('x')] })).status,
    ).toBe(404);
  });

  it('cascades a space delete to its messages but leaves other tables alone', async () => {
    const task = await t.base.task.create({ data: { title: '残るタスク' } });
    await t.base.assistantAction.create({
      data: { capabilityId: 'task.create', status: 'executed', taskId: task.id },
    });
    await t.base.copilotMessage.create({
      data: { taskId: task.id, role: 'user', content: '残る相談' },
    });
    const id = await newSpace();
    await call('PUT', `/rapi-chat/spaces/${id}/messages`, {
      messages: [textItem('a'), textItem('b', { taskId: task.id, role: 'system' })],
    });
    expect(await t.base.rapiChatMessage.count()).toBe(2);
    await call('DELETE', `/rapi-chat/spaces/${id}`);
    expect(await t.base.rapiChatMessage.count()).toBe(0);
    expect(await t.base.task.count({ where: { id: task.id } })).toBe(1);
    // Design §3.2: actions and the old consultation log are not part of a space.
    expect(await t.base.assistantAction.count()).toBe(1);
    expect(await t.base.copilotMessage.count()).toBe(1);
  });

  it('POST with the same clientKey returns the same space (200) and makes one row', async () => {
    const first = await call('POST', '/rapi-chat/spaces', { clientKey: 'local-1' });
    const again = await call('POST', '/rapi-chat/spaces', { clientKey: 'local-1' });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.json.space.id).toBe(first.json.space.id);
    await call('POST', '/rapi-chat/spaces', {});
    await call('POST', '/rapi-chat/spaces', {});
    expect(await t.base.rapiChatSpace.count()).toBe(3);
  });

  it('refuses the 101st space with 409 space_limit', async () => {
    await t.base.rapiChatSpace.createMany({ data: Array.from({ length: 100 }, () => ({})) });
    const r = await call('POST', '/rapi-chat/spaces', {});
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('space_limit');
  });
});

describe('PUT messages', () => {
  it('is idempotent per clientId: the row is rewritten in place', async () => {
    const id = await newSpace();
    const first = await call('PUT', `/rapi-chat/spaces/${id}/messages`, {
      messages: [textItem('m')],
    });
    const again = await call('PUT', `/rapi-chat/spaces/${id}/messages`, {
      messages: [textItem('m', { text: '書き換え' })],
    });
    expect(again.json.saved[0].id).toBe(first.json.saved[0].id);
    const rows = await t.base.rapiChatMessage.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('書き換え');
  });

  it('deletes with deleted:true and tolerates an unknown clientId', async () => {
    const id = await newSpace();
    await call('PUT', `/rapi-chat/spaces/${id}/messages`, { messages: [textItem('m')] });
    const r = await call('PUT', `/rapi-chat/spaces/${id}/messages`, {
      messages: [
        { clientId: 'm', deleted: true },
        { clientId: 'nope', deleted: true },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.json.removed).toEqual(['m', 'nope']);
    expect(await t.base.rapiChatMessage.count()).toBe(0);
  });

  it('keeps the payload string byte-for-byte (Japanese, emoji, nesting)', async () => {
    const id = await newSpace();
    const payload = JSON.stringify({
      v: 1,
      kind: 'change',
      change: { proposal: { title: '日本語👨‍👩‍👧 タスク', changes: { a: [1, { b: '入れ子' }] } } },
    });
    await call('PUT', `/rapi-chat/spaces/${id}/messages`, {
      messages: [textItem('c', { role: 'assistant', kind: 'change', text: '', payload })],
    });
    const page = await call('GET', `/rapi-chat/spaces/${id}/messages`);
    expect(page.json.messages[0].payload).toBe(payload);
  });

  it('refuses a malformed body with 400 and saves nothing', async () => {
    const id = await newSpace();
    const url = `/rapi-chat/spaces/${id}/messages`;
    expect((await call('PUT', url, { messages: 'x' })).status).toBe(400);
    expect(
      (await call('PUT', url, { messages: [textItem('a'), { ...textItem('b'), clientId: '' }] }))
        .status,
    ).toBe(400);
    expect(
      (await call('PUT', url, { messages: [{ ...textItem('b'), clientId: undefined }] })).status,
    ).toBe(400);
    expect((await call('PUT', url, { messages: [textItem('a'), textItem('a')] })).status).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => textItem(`n${i}`));
    expect((await call('PUT', url, { messages: many })).status).toBe(400);
    expect(await t.base.rapiChatMessage.count()).toBe(0);
  });

  it('refuses invalid items with 422 naming only them, and saves nothing', async () => {
    const id = await newSpace();
    const url = `/rapi-chat/spaces/${id}/messages`;
    const card = (kind: string, payload: string) =>
      textItem(`p-${kind}-${payload.length}`, { role: 'assistant', kind, text: '', payload });
    const bad = [
      textItem('long', { text: 'あ'.repeat(32_001) }),
      // 90,000 characters but 270,000 UTF-8 bytes: over by bytes, not characters.
      card('tidy', JSON.stringify({ v: 1, kind: 'tidy', tidy: { t: 'あ'.repeat(90_000) } })),
      card('answer', JSON.stringify({ v: 1, kind: 'change' })),
      card('change', '{"v":0,"kind":"change"}'),
      card('roadmap', '{"v":1.0,"kind":"roadmap"}'),
      card('companion', '{"v":"1","kind":"companion"}'),
      card('answer', '{broken'),
      card('change', '{"kind":"change"}'),
      textItem('role', { role: 'robot' }),
      textItem('kind', { kind: 'picker' }),
    ];
    const r = await call('PUT', url, { messages: [textItem('ok1'), ...bad, textItem('ok2')] });
    expect(r.status).toBe(422);
    expect(r.json.error).toBe('invalid_items');
    const codes = Object.fromEntries(
      (r.json.rejected as Array<{ clientId: string; code: string }>).map((x) => [
        x.clientId,
        x.code,
      ]),
    );
    expect(Object.keys(codes)).toHaveLength(bad.length);
    expect(codes.long).toBe('text_too_long');
    expect(codes.role).toBe('invalid_role');
    expect(codes.kind).toBe('invalid_kind');
    expect(Object.values(codes).filter((c) => c === 'payload_too_large')).toHaveLength(1);
    expect(Object.values(codes).filter((c) => c === 'invalid_payload')).toHaveLength(6);
    expect(await t.base.rapiChatMessage.count()).toBe(0);

    const retry = await call('PUT', url, { messages: [textItem('ok1'), textItem('ok2')] });
    expect(retry.status).toBe(200);
    expect(await t.base.rapiChatMessage.count()).toBe(2);
  });

  it('judges the version by the top-level v only, whatever is nested (422, nothing saved)', async () => {
    const id = await newSpace();
    const url = `/rapi-chat/spaces/${id}/messages`;
    const card = (cid: string, kind: string, payload: string) =>
      textItem(cid, { role: 'assistant', kind, text: '', payload });
    const bad = [
      card('frac', 'answer', '{"v":1.0,"kind":"answer","answer":{"v":1}}'),
      card('str', 'answer', '{"v":"1","kind":"answer","answer":{"v":1}}'),
      card('zero', 'change', '{"v":0,"kind":"change","change":{"v":1,"x":[{"v":2}]}}'),
      card('exp', 'tidy', '{"kind":"tidy","tidy":{"v":1},"v":1e0}'),
      card('dup', 'roadmap', '{"v":1,"kind":"roadmap","v":1.0}'),
      card('nested-only', 'answer', '{"kind":"answer","answer":{"v":1}}'),
    ];
    const good = [
      textItem('ok1'),
      card('good-nested', 'answer', '{ "kind" : "answer", "answer":{"v":1.5,"s":"\\"v\\":1.0"}, "v" : 2 }'),
    ];
    const r = await call('PUT', url, { messages: [good[0], ...bad, good[1]] });
    expect(r.status).toBe(422);
    const rejected = (r.json.rejected as Array<{ clientId: string; code: string }>)
      .map((x) => `${x.clientId}:${x.code}`)
      .sort();
    expect(rejected).toEqual(bad.map((b) => `${b.clientId}:invalid_payload`).sort());
    expect(await t.base.rapiChatMessage.count()).toBe(0);

    const retry = await call('PUT', url, { messages: good });
    expect(retry.status).toBe(200);
    expect(await t.base.rapiChatMessage.count()).toBe(2);
  });
});

describe('PUT message limit (count after the PUT)', () => {
  it('refuses new rows past 2,000 but names only the new ones', async () => {
    const id = await newSpace();
    await seedMessages(t.base, id, 1999);
    const url = `/rapi-chat/spaces/${id}/messages`;
    const r = await call('PUT', url, {
      messages: [textItem('new1'), textItem('new2'), textItem('seed-0', { text: '確定' })],
    });
    expect(r.status).toBe(409);
    expect(r.json.remaining).toBe(1);
    expect(r.json.rejected.map((x: { clientId: string }) => x.clientId)).toEqual(['new1', 'new2']);
    expect(await t.base.rapiChatMessage.count()).toBe(1999);

    const ok = await call('PUT', url, {
      messages: [textItem('seed-0', { text: '確定' }), textItem('new1')],
    });
    expect(ok.status).toBe(200);
    expect(await t.base.rapiChatMessage.count()).toBe(2000);
  });

  it('at 2,000: overwrite-only, delete-only and delete+1 pass; delete+3 gives remaining 1', async () => {
    const id = await newSpace();
    await seedMessages(t.base, id, 2000);
    const url = `/rapi-chat/spaces/${id}/messages`;
    expect((await call('PUT', url, { messages: [textItem('seed-1', { text: 'x' })] })).status).toBe(
      200,
    );
    expect((await call('PUT', url, { messages: [textItem('seed-1', { text: 'x' })] })).status).toBe(
      200,
    );
    expect(
      (await call('PUT', url, { messages: [{ clientId: 'seed-2', deleted: true }] })).status,
    ).toBe(200);
    expect(
      (
        await call('PUT', url, {
          messages: [{ clientId: 'seed-3', deleted: true }, textItem('n1'), textItem('n0')],
        })
      ).status,
    ).toBe(200);
    // Now 2,000 again. Delete one and add three.
    const r = await call('PUT', url, {
      messages: [
        { clientId: 'seed-4', deleted: true },
        textItem('a'),
        textItem('b'),
        textItem('c'),
      ],
    });
    expect(r.status).toBe(409);
    expect(r.json.remaining).toBe(1);
    expect(await t.base.rapiChatMessage.count()).toBe(2000);
  });
});

describe('GET messages paging', () => {
  it('returns oldest-first pages with hasMore and a gap-free nextBefore', async () => {
    const id = await newSpace();
    const url = `/rapi-chat/spaces/${id}/messages`;
    expect((await call('GET', url)).json).toEqual({
      success: true,
      messages: [],
      hasMore: false,
      nextBefore: null,
    });
    await seedMessages(t.base, id, 50);
    const exact = await call('GET', url);
    expect(exact.json.messages).toHaveLength(50);
    expect(exact.json.hasMore).toBe(false);

    await call('PUT', url, { messages: [textItem('late')] });
    const p1 = await call('GET', url);
    expect(p1.json.messages).toHaveLength(50);
    expect(p1.json.hasMore).toBe(true);
    expect(p1.json.messages.at(-1).clientId).toBe('late');
    const ids1 = p1.json.messages.map((m: { id: number }) => m.id);
    expect(ids1).toEqual([...ids1].sort((a, b) => a - b));
    expect(p1.json.nextBefore).toBe(ids1[0]);

    const p2 = await call('GET', `${url}?before=${p1.json.nextBefore}&limit=100`);
    expect(p2.json.messages).toHaveLength(1);
    expect(p2.json.hasMore).toBe(false);
    expect(p2.json.messages[0].id).toBe(ids1[0] - 1);
  });
});
