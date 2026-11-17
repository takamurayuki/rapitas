/**
 * copilot-note tests
 *
 * The note built from a copilot reply (title and body), the PUT it is saved
 * with, and the task link that follows only when the panel has a task.
 */
import { buildCopilotNote, questionBefore, saveCopilotNote } from '../copilot-note';
import { useNoteStore } from '@/stores/note-store';
import type { CopilotMessage } from '../useCopilotChat';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test' }));

const ok = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
const status = (code: number) =>
  Promise.resolve({ ok: false, status: code, json: () => Promise.resolve({}) });

function calls() {
  return vi.mocked(global.fetch).mock.calls.map(([url, init]) => ({
    url: String(url),
    method: (init as RequestInit | undefined)?.method,
    body: JSON.parse(String((init as RequestInit | undefined)?.body ?? 'null')),
  }));
}

describe('buildCopilotNote', () => {
  it('titles the note with the question and keeps both question and answer', () => {
    const note = buildCopilotNote(
      'ログインのバグはどこから調べる？\n補足です',
      '- まずログを見る\n- **再現手順**を書く',
    );
    expect(note.title).toBe('ログインのバグはどこから調べる？');
    expect(note.content).toBe(
      '## 質問\n\nログインのバグはどこから調べる？\n補足です\n\n## ラピの回答\n\n- まずログを見る\n- **再現手順**を書く\n',
    );
  });

  it('cuts a long question at 30 characters', () => {
    const question = 'あ'.repeat(40);
    expect(buildCopilotNote(question, '答え').title).toBe(`${'あ'.repeat(30)}…`);
  });

  it('falls back to the reply first line, then to a fixed title', () => {
    expect(buildCopilotNote(null, '## 今週の進め方\n本文').title).toBe('今週の進め方');
    expect(buildCopilotNote(null, '## 今週の進め方').content).toBe(
      '## ラピの回答\n\n## 今週の進め方\n',
    );
    expect(buildCopilotNote('  ', '   ').title).toBe('ラピとの会話');
  });
});

describe('questionBefore', () => {
  const m = (id: string, role: CopilotMessage['role'], content: string): CopilotMessage => ({
    id,
    role,
    content,
    createdAt: '2026-11-17T00:00:00Z',
  });

  it('takes the nearest user line before the reply', () => {
    const lines = [
      m('1', 'user', '最初'),
      m('2', 'assistant', 'a'),
      m('3', 'user', '次'),
      m('4', 'assistant', 'b'),
    ];
    expect(questionBefore(lines, '4')).toBe('次');
    expect(questionBefore(lines, '2')).toBe('最初');
    expect(questionBefore([m('9', 'assistant', '振り返り')], '9')).toBeNull();
  });
});

describe('saveCopilotNote', () => {
  const draft = { title: '質問', content: '## 質問\n\n質問\n\n## ラピの回答\n\n答え\n' };

  beforeEach(() => {
    useNoteStore.setState({ notes: [] });
    global.fetch = vi.fn(ok) as unknown as typeof fetch;
  });

  it('PUTs the title and body, then links the note to the task', async () => {
    const result = await saveCopilotNote(draft, 42, () => 1731800000000);

    expect(result).toEqual({ noteId: '1731800000000', linked: true, mirrored: true });
    expect(calls()).toEqual([
      {
        url: 'http://test/notes/1731800000000',
        method: 'PUT',
        body: { title: draft.title, content: draft.content },
      },
      { url: 'http://test/notes/1731800000000/links', method: 'POST', body: { taskId: 42 } },
    ]);
    // Shown on the desktop notes page too, linked to the task.
    expect(useNoteStore.getState().notes[0]).toMatchObject({
      id: '1731800000000',
      title: draft.title,
      linkedTaskIds: [42],
    });
  });

  it('does not link when there is no task', async () => {
    const result = await saveCopilotNote(draft, null, () => 1);
    expect(result.linked).toBeNull();
    expect(calls().map((c) => c.method)).toEqual(['PUT']);
  });

  it('reports a failed link without failing the save', async () => {
    global.fetch = vi.fn((url: string) =>
      url.endsWith('/links') ? status(500) : ok(),
    ) as unknown as typeof fetch;
    const result = await saveCopilotNote(draft, 42, () => 7);
    expect(result).toEqual({ noteId: '7', linked: false, mirrored: true });
    expect(useNoteStore.getState().notes[0].linkedTaskIds).toBeUndefined();
  });

  it('keeps the server save when the local copy fails (e.g. localStorage is full)', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    try {
      const result = await saveCopilotNote(draft, 42, () => 9);
      expect(result).toEqual({ noteId: '9', linked: true, mirrored: false });
      expect(calls().map((c) => c.method)).toEqual(['PUT', 'POST']);
    } finally {
      setItem.mockRestore();
    }
  });

  it('throws when the note itself was not saved, and does not link or keep it', async () => {
    global.fetch = vi.fn(() => status(422)) as unknown as typeof fetch;
    await expect(saveCopilotNote(draft, 42, () => 8)).rejects.toThrow();
    expect(calls().map((c) => c.method)).toEqual(['PUT']);
    expect(useNoteStore.getState().notes).toEqual([]);
  });
});
