/**
 * rapi-chat services tests
 *
 * The automatic title (design §7.1) and workspace behaviour (§3.2, §4.2 A3)
 * over a real SQLite database with the production workspace extension.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { runInWorkspace } from '../tenancy/workspace-context';
import { autoTitle } from './snapshot-limits';
import { createSpace, listSpaces } from './space-service';
import { putMessages } from './message-service';
import { createRapiChatTestDb, textItem, type RapiChatTestDb } from './rapi-chat.test-helpers';

describe('autoTitle', () => {
  it('collapses whitespace and keeps a short text whole', () => {
    expect(autoTitle('  ラピ、\n今日の\t予定   を教えて ')).toBe('ラピ、 今日の 予定 を教えて');
  });
  it('cuts past 20 graphemes to 19 + 「…」, counting emoji clusters as one', () => {
    const family = '👨‍👩‍👧';
    const text = family.repeat(25);
    expect(autoTitle(text)).toBe(`${family.repeat(19)}…`);
    expect(autoTitle('あ'.repeat(20))).toBe('あ'.repeat(20));
    expect(autoTitle('あ'.repeat(21))).toBe(`${'あ'.repeat(19)}…`);
  });
  it('gives null for blank text', () => {
    expect(autoTitle(' \n\t ')).toBeNull();
  });
});

let t: RapiChatTestDb;
beforeEach(() => {
  t = createRapiChatTestDb();
});
afterEach(async () => {
  await t.dispose();
});

async function space(): Promise<number> {
  const r = await createSpace(t.db, { title: null, clientKey: null });
  if (r.kind === 'limit') throw new Error('limit');
  return r.space.id;
}

describe('title from the first user text message', () => {
  it('is set once, from the first user text only', async () => {
    const id = await space();
    await putMessages(t.db, id, [
      textItem('sys', { role: 'system', text: '起票しました' }),
      textItem('a', { role: 'assistant', text: 'こんにちは' }),
    ]);
    expect((await t.base.rapiChatSpace.findFirstOrThrow({ where: { id } })).title).toBeNull();
    const r = await putMessages(t.db, id, [textItem('u1', { text: '最初の相談' })]);
    expect(r.kind === 'saved' && r.space.title).toBe('最初の相談');
    await putMessages(t.db, id, [textItem('u2', { text: '二つ目' })]);
    expect((await t.base.rapiChatSpace.findFirstOrThrow({ where: { id } })).title).toBe(
      '最初の相談',
    );
  });

  it("leaves a titleSource='user' space alone", async () => {
    const id = await space();
    await t.base.rapiChatSpace.update({ where: { id }, data: { titleSource: 'user' } });
    await putMessages(t.db, id, [textItem('u1', { text: '自動で付けない' })]);
    expect((await t.base.rapiChatSpace.findFirstOrThrow({ where: { id } })).title).toBeNull();
  });
});

describe('workspaces', () => {
  it('counts the space limit within the target workspace only (cookie-less = NULL)', async () => {
    await t.base.rapiChatSpace.createMany({
      data: [
        ...Array.from({ length: 100 }, () => ({ workspaceId: 7 })),
        ...Array.from({ length: 99 }, () => ({})),
      ],
    });
    const ok = await createSpace(t.db, { title: null, clientKey: null });
    expect(ok.kind).toBe('created');
    expect((await createSpace(t.db, { title: null, clientKey: null })).kind).toBe('limit');
    // A scoped request is judged on its own workspace (7 is full, 8 is empty).
    expect(
      (await runInWorkspace(7, () => createSpace(t.db, { title: null, clientKey: null }))).kind,
    ).toBe('limit');
    expect(
      (await runInWorkspace(8, () => createSpace(t.db, { title: null, clientKey: null }))).kind,
    ).toBe('created');
    // Cookie-less listing sees every workspace (the existing rule).
    expect(await listSpaces(t.db)).toHaveLength(201);
  });

  it('writes cookie-less rows with a NULL workspace and copies the space workspace to messages', async () => {
    const nullId = await space();
    await putMessages(t.db, nullId, [textItem('m')]);
    const scoped = await runInWorkspace(3, () =>
      createSpace(t.db, { title: null, clientKey: 'k' }),
    );
    if (scoped.kind === 'limit') throw new Error('limit');
    // A sessionless PUT into the scoped space still stamps the parent's workspace.
    await putMessages(t.db, scoped.space.id, [textItem('m2')]);

    const spaces = await t.base.rapiChatSpace.findMany({ orderBy: { id: 'asc' } });
    expect(spaces.map((s) => s.workspaceId)).toEqual([null, 3]);
    const msgs = await t.base.rapiChatMessage.findMany({ orderBy: { id: 'asc' } });
    expect(msgs.map((m) => m.workspaceId)).toEqual([null, 3]);
  });

  it('a clientKey resend inside the same workspace returns the existing space', async () => {
    const a = await runInWorkspace(3, () => createSpace(t.db, { title: null, clientKey: 'k' }));
    const b = await runInWorkspace(3, () => createSpace(t.db, { title: null, clientKey: 'k' }));
    expect(a.kind).toBe('created');
    expect(b.kind).toBe('existing');
  });
});
