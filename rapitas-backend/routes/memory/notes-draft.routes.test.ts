/**
 * notes-draft.routes.test
 *
 * `POST /notes/draft-from-reply` (nav70): the answer alone goes in, a titled
 * draft comes out, and nothing is written. An empty answer is the caller's
 * mistake (400); a failed draft is an error (502) so the client saves nothing
 * rather than an unformatted note.
 *
 * Both service modules are stubbed via mock.module with every export
 * mirrored — Bun replaces the whole module.
 */
import { describe, expect, mock, test, beforeEach } from 'bun:test';

let draftResult: { title: string; content: string } | Error = { title: 't', content: 'c\n' };
let drafted: string[] = [];
let saves = 0;

mock.module('../../services/notes/note-draft', () => ({
  draftNoteFromReply: async (answer: string) => {
    drafted.push(answer);
    if (draftResult instanceof Error) throw draftResult;
    return draftResult;
  },
  parseNoteDraftReply: () => ({ title: '', content: '' }),
  resolveNoteDraftTitle: () => 'ラピとの会話',
  NoteDraftUnavailableError: class extends Error {},
  NOTE_DRAFT_FALLBACK_TITLE: 'ラピとの会話',
  NOTE_DRAFT_TITLE_MAX: 30,
}));

mock.module('../../services/notes/note-service', () => ({
  listNotes: async () => [],
  getNote: async () => null,
  saveNote: async () => {
    saves++;
    return {};
  },
  deleteNote: async () => false,
  linkNote: async () => {},
  unlinkNote: async () => false,
  importNotes: async () => ({ imported: 0, skipped: 0 }),
  MAX_NOTE_TITLE: 300,
  MAX_NOTE_CONTENT: 200000,
  MAX_NOTE_TAGS: 30,
}));

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {},
}));

const { notesRoutes } = await import('./notes.routes');

const post = (body: unknown) =>
  notesRoutes.handle(
    new Request('http://local/notes/draft-from-reply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  draftResult = { title: 't', content: 'c\n' };
  drafted = [];
  saves = 0;
});

describe('POST /notes/draft-from-reply', () => {
  test('returns the draft for the answer and writes no note', async () => {
    draftResult = { title: 'ログイン不具合の調べ方', content: '## 手順\n\n- ログを見る\n' };
    const res = await post({ answer: 'まずログを見ます。' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      title: 'ログイン不具合の調べ方',
      content: '## 手順\n\n- ログを見る\n',
    });
    expect(drafted).toEqual(['まずログを見ます。']);
    expect(saves).toBe(0);
  });

  test('an empty or blank answer is a 400 and the model is not asked', async () => {
    for (const answer of ['', '  \n ']) {
      const res = await post({ answer });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ success: false, error: 'empty_answer' });
    }
    expect(drafted).toEqual([]);
  });

  test('a failed draft is a 502, not a draft', async () => {
    draftResult = new Error('cli down');
    const res = await post({ answer: '答え' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ success: false, error: 'draft_failed' });
  });

  test('a body without answer is rejected by validation', async () => {
    const res = await post({ question: '質問' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(drafted).toEqual([]);
  });
});
