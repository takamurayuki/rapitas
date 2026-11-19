/**
 * copilot-note tests
 *
 * The draft asked for from a copilot reply (answer only), the PUT the note
 * is saved with, and the task link that follows only when the panel has a task.
 */
import { draftCopilotNote, saveCopilotNote } from '../copilot-note';
import { useNoteStore } from '@/stores/note-store';

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

describe('draftCopilotNote', () => {
  it('sends only the answer and returns the drafted title and body', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            title: 'ログの見方',
            content: '## 手順\n\n- ログを見る\n',
          }),
      }),
    ) as unknown as typeof fetch;

    const draft = await draftCopilotNote('まず **ログ** を見ます。');

    expect(draft).toEqual({ title: 'ログの見方', content: '## 手順\n\n- ログを見る\n' });
    expect(calls()).toEqual([
      {
        url: 'http://test/notes/draft-from-reply',
        method: 'POST',
        body: { answer: 'まず **ログ** を見ます。' },
      },
    ]);
  });

  it('throws when the server could not draft (502)', async () => {
    global.fetch = vi.fn(() => status(502)) as unknown as typeof fetch;
    await expect(draftCopilotNote('答え')).rejects.toThrow();
  });

  it('throws when the reply has no body', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ title: 't', content: '  ' }) }),
    ) as unknown as typeof fetch;
    await expect(draftCopilotNote('答え')).rejects.toThrow();
  });
});

describe('saveCopilotNote', () => {
  const draft = { title: 'ログの見方', content: '## 手順\n\n- ログを見る\n' };

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

  // NOTE: the store reads the server since stage 0, so the local copy is the
  // screen's list rather than localStorage; a failure there is still not a
  // failed save (a retry would mint a second note).
  it('keeps the server save when the screen copy cannot be updated', async () => {
    const upsert = vi.spyOn(useNoteStore.getState(), 'upsertNote').mockImplementation(() => {
      throw new Error('store unavailable');
    });
    try {
      const result = await saveCopilotNote(draft, 42, () => 9);
      expect(result).toEqual({ noteId: '9', linked: true, mirrored: false });
      expect(calls().map((c) => c.method)).toEqual(['PUT', 'POST']);
    } finally {
      upsert.mockRestore();
    }
  });

  it('throws when the note itself was not saved, and does not link or keep it', async () => {
    global.fetch = vi.fn(() => status(422)) as unknown as typeof fetch;
    await expect(saveCopilotNote(draft, 42, () => 8)).rejects.toThrow();
    expect(calls().map((c) => c.method)).toEqual(['PUT']);
    expect(useNoteStore.getState().notes).toEqual([]);
  });
});
