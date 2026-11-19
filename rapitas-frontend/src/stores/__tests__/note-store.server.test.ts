/**
 * note-store.server.test
 *
 * The desktop note store once its source is the server (completion
 * condition 1): the list comes from `GET /notes`, every change is a request,
 * writes to one note reach the server in order, and the browser's own copy
 * (`note-storage`) is never written again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useNoteStore } from '../note-store';
import { LOCAL_NOTE_STORAGE_KEY } from '../note/note-local-backup';

interface Sent {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

let sent: Sent[] = [];
let serverNotes: Record<string, unknown>[] = [];
let failNext: { status: number; error?: string } | null = null;

const serverNote = (over: Record<string, unknown> = {}) => ({
  id: 'phone-1',
  title: 'スマホで作ったメモ',
  content: '本文',
  isPinned: false,
  tags: [],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
  linkedTaskIds: [7],
  linkedTaskMeta: { '7': { themeName: 'テーマ' } },
  ...over,
});

beforeEach(() => {
  sent = [];
  serverNotes = [serverNote()];
  failNext = null;
  localStorage.clear();
  useNoteStore.setState({
    source: 'server',
    notes: [],
    currentNoteId: null,
    loadState: 'idle',
    loadedAt: 0,
    syncError: null,
  });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    sent.push({ method, path, body });
    // Let the store's queue run in a later tick, like a real request.
    await new Promise((r) => setTimeout(r, 0));
    if (failNext) {
      const { status, error } = failNext;
      failNext = null;
      return { ok: false, status, json: async () => ({ success: false, error }) } as Response;
    }
    const reply = method === 'GET' ? { notes: serverNotes } : { note: serverNote({ ...body }) };
    return { ok: true, status: 200, json: async () => reply } as Response;
  });
});

afterEach(() => vi.unstubAllGlobals());

const flush = () => new Promise((r) => setTimeout(r, 20));

describe('reading', () => {
  it('loads the list from the server, so a note the phone made is on the desktop', async () => {
    await useNoteStore.getState().loadNotes();
    const [note] = useNoteStore.getState().notes;
    expect(sent[0]).toMatchObject({ method: 'GET', path: '/notes' });
    expect(note?.id).toBe('phone-1');
    expect(note?.linkedTaskIds).toEqual([7]);
    expect(note?.updatedAt).toBeInstanceOf(Date);
  });

  it('does not reload a fresh list, and reloads an old one', async () => {
    await useNoteStore.getState().loadNotes();
    useNoteStore.getState().ensureLoaded();
    expect(sent).toHaveLength(1);
    useNoteStore.getState().ensureLoaded(0);
    await flush();
    expect(sent).toHaveLength(2);
  });
});

describe('writing', () => {
  it('creates a note on the server with an empty Markdown body, and makes no extra blank one', async () => {
    const id = useNoteStore.getState().createNote('新規');
    await flush();
    expect(sent).toEqual([
      { method: 'PATCH', path: `/notes/${id}`, body: { title: '新規', content: '' } },
    ]);
    expect(useNoteStore.getState().notes.map((n) => n.id)).toEqual([id]);
    expect(useNoteStore.getState().currentNoteId).toBe(id);
  });

  it('sends only the fields that changed, in order per note', async () => {
    const id = useNoteStore.getState().createNote();
    useNoteStore.getState().updateNote(id, { content: '一行目' });
    useNoteStore.getState().updateNote(id, { title: 'タイトル', linkedTaskIds: [1] });
    await flush();
    expect(sent.map((s) => s.body)).toEqual([
      { title: '', content: '' },
      { content: '一行目' },
      { title: 'タイトル' },
    ]);
  });

  it('links on the server after the note exists, carrying the meta', async () => {
    const id = useNoteStore.getState().createNote();
    const linked = useNoteStore
      .getState()
      .linkNoteToTask(id, 7, { taskTitle: 'T', themeName: 'Th', categoryName: 'C' });
    expect(await linked).toBe(true);
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual([
      `PATCH /notes/${id}`,
      `POST /notes/${id}/links`,
    ]);
    expect(sent[1]?.body).toEqual({
      taskId: 7,
      meta: { taskTitle: 'T', themeName: 'Th', categoryName: 'C' },
    });
  });

  it('rolls a refused link back and reports it', async () => {
    await useNoteStore.getState().loadNotes();
    failNext = { status: 404, error: 'task_not_found' };
    expect(await useNoteStore.getState().linkNoteToTask('phone-1', 70)).toBe(false);
    expect(useNoteStore.getState().notes[0]?.linkedTaskIds).toEqual([7]);
    expect(useNoteStore.getState().syncError).toBe('link_failed');
  });

  it('deletes and unlinks on the server', async () => {
    await useNoteStore.getState().loadNotes();
    useNoteStore.getState().unlinkNoteFromTask('phone-1', 7);
    useNoteStore.getState().deleteNote('phone-1');
    await flush();
    expect(sent.slice(1).map((s) => `${s.method} ${s.path}`)).toEqual([
      'DELETE /notes/phone-1/links/7',
      'DELETE /notes/phone-1',
    ]);
    expect(useNoteStore.getState().notes).toEqual([]);
  });

  it('reports a refused HTML body as legacy_html', async () => {
    await useNoteStore.getState().loadNotes();
    failNext = { status: 400, error: 'legacy_html_content' };
    useNoteStore.getState().updateNote('phone-1', { content: '<div>x</div>' });
    await flush();
    expect(useNoteStore.getState().syncError).toBe('legacy_html');
  });

  it('never writes the browser copy once the source is the server', async () => {
    const id = useNoteStore.getState().createNote('x');
    useNoteStore.getState().updateNote(id, { content: 'y' });
    await flush();
    expect(localStorage.getItem(LOCAL_NOTE_STORAGE_KEY)).toBeNull();
  });
});

describe('the pre-migration store', () => {
  it('keeps writing the browser copy and sends nothing', () => {
    useNoteStore.setState({ source: 'local' });
    const id = useNoteStore.getState().createNote('ローカル');
    expect(sent).toEqual([]);
    const saved = JSON.parse(localStorage.getItem(LOCAL_NOTE_STORAGE_KEY) ?? '{}');
    expect(saved.state.notes[0].id).toBe(id);
  });

  it('switches to the server: drops the local list and loads the server one', async () => {
    useNoteStore.setState({ source: 'local' });
    useNoteStore.getState().createNote('ローカル');
    await useNoteStore.getState().switchToServer();
    expect(useNoteStore.getState().source).toBe('server');
    expect(useNoteStore.getState().notes.map((n) => n.id)).toEqual(['phone-1']);
  });
});
