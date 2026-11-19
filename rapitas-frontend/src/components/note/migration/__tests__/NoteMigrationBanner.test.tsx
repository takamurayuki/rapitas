/**
 * NoteMigrationBanner.test
 *
 * The migration as the user meets it on the /notes page, against an
 * in-memory server: the band, the backup before anything is sent, the
 * difference list with the newer side preselected, the end that switches
 * the store to the server (completion condition 1), and a started
 * migration resuming by itself on the next open (condition 3), and no "done"
 * while a local edit or a blocked note is not on the server.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useNoteStore } from '@/stores/note-store';
import { LOCAL_NOTE_STORAGE_KEY, readLocalNotes } from '@/stores/note/note-local-backup';
import {
  INITIAL_RECORD,
  NOTE_MIGRATION_KEY,
  readMigrationRecord,
} from '@/stores/note/note-migration-record';
import NoteMigrationBanner from '../NoteMigrationBanner';
import { useNoteMigration } from '../useNoteMigration';
import { createFakeNoteServer, fakeHash } from './fake-note-server';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${ns}.${key}:${Object.values(values).join(',')}` : `${ns}.${key}`,
}));

let server: ReturnType<typeof createFakeNoteServer>;
let downloads: { fileName: string; json: string }[] = [];

const localNote = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `ノート ${id}`,
  content: `本文 ${id}`,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-11-18T00:00:00.000Z',
  isPinned: false,
  tags: [],
  ...over,
});

function seedLocal(notes: Record<string, unknown>[]) {
  // Store first: in local mode the store persists its list to the same key,
  // so seeding the key before would be overwritten by this setState.
  useNoteStore.setState({ source: 'local', notes: [], loadState: 'idle', syncError: null });
  localStorage.setItem(
    LOCAL_NOTE_STORAGE_KEY,
    JSON.stringify({ state: { notes, currentNoteId: null }, version: 0 }),
  );
}

function Harness() {
  const migration = useNoteMigration({
    api: server.api,
    hash: fakeHash,
    download: (fileName, json) => downloads.push({ fileName, json }),
  });
  return <NoteMigrationBanner migration={migration} />;
}

beforeEach(() => {
  localStorage.clear();
  downloads = [];
  server = createFakeNoteServer();
  // switchToServer's GET /notes after the migration.
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ notes: [] }),
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe('starting', () => {
  it('offers the move, writes the backup first, then lists the differences', async () => {
    server.put('chat', { title: 'ノート chat', content: 'サーバーの本文' });
    seedLocal([
      localNote('only-pc'),
      localNote('chat'),
      localNote('blank', { title: '', content: '' }),
    ]);
    render(<Harness />);
    expect(screen.getByText('notes.migration.notStartedBody:2')).toBeTruthy();
    expect(server.calls.fetchManifest).toBe(0);

    fireEvent.click(screen.getByText('notes.migration.start'));
    expect(downloads).toHaveLength(1);
    expect(JSON.parse(downloads[0]?.json ?? '{}').data.state.notes).toHaveLength(3);

    await screen.findByTestId('note-migration-diffs');
    expect(server.notes.has('only-pc')).toBe(true);
    const row = screen.getByTestId('note-migration-diff-chat');
    expect(row.textContent).toContain('notes.migration.fieldContent');
    // The PC copy is newer, so "use the PC version" starts selected.
    const pc = screen.getByLabelText('notes.migration.choicePc') as HTMLInputElement;
    expect(pc.checked).toBe(true);
    expect(readMigrationRecord().backedUpAt).not.toBeNull();
  });

  it('applies the choices, switches the store to the server and keeps the backup', async () => {
    server.put('chat', { title: 'ノート chat', content: 'サーバーの本文' });
    seedLocal([localNote('chat')]);
    const backup = localStorage.getItem(LOCAL_NOTE_STORAGE_KEY);
    render(<Harness />);
    fireEvent.click(screen.getByText('notes.migration.start'));
    await screen.findByTestId('note-migration-diffs');
    fireEvent.click(screen.getByLabelText('notes.migration.choiceServer'));
    fireEvent.click(screen.getByText('notes.migration.apply'));
    await screen.findByText('notes.migration.doneTitle');
    expect(server.notes.get('chat')?.content).toBe('サーバーの本文');
    expect(useNoteStore.getState().source).toBe('server');
    expect(readMigrationRecord().phase).toBe('done');
    expect(localStorage.getItem(LOCAL_NOTE_STORAGE_KEY)).toBe(backup);
  });
});

describe('not finishing while something is not on the server', () => {
  it('re-lists a note edited in the still-local store after the list was shown', async () => {
    server.put('chat', { title: 'ノート chat', content: 'サーバーの本文' });
    seedLocal([localNote('chat')]);
    render(<Harness />);
    fireEvent.click(screen.getByText('notes.migration.start'));
    await screen.findByTestId('note-migration-diffs');
    // The page still shows the local notes; an edit there goes to the local store.
    const [chat] = readLocalNotes().notes;
    useNoteStore.setState({
      notes: [{ ...chat!, content: '表示の後の編集', updatedAt: new Date('2026-11-19T09:00:00Z') }],
    });
    fireEvent.click(screen.getByText('notes.migration.apply'));
    await screen.findByTestId('note-migration-diffs');
    expect(screen.queryByText('notes.migration.doneTitle')).toBeNull();
    expect(useNoteStore.getState().source).toBe('local');
    fireEvent.click(screen.getByText('notes.migration.apply'));
    await screen.findByText('notes.migration.doneTitle');
    expect(server.notes.get('chat')?.content).toBe('表示の後の編集');
  });

  it('lists the notes another workspace blocks and keeps the local view', async () => {
    server.foreign.add('held');
    seedLocal([localNote('held'), localNote('free')]);
    render(<Harness />);
    fireEvent.click(screen.getByText('notes.migration.start'));
    const blocked = await screen.findByTestId('note-migration-blocked');
    expect(blocked.textContent).toContain('ノート held');
    expect(screen.queryByText('notes.migration.doneTitle')).toBeNull();
    expect(useNoteStore.getState().source).toBe('local');
    expect(readMigrationRecord().phase).not.toBe('done');
    fireEvent.click(screen.getByText('notes.migration.blockedRetry'));
    await screen.findByTestId('note-migration-blocked');
    expect(readMigrationRecord().phase).not.toBe('done');
  });
});

describe('resuming', () => {
  it('continues a started migration on open, without asking to start again', async () => {
    seedLocal([localNote('a'), localNote('b')]);
    server.put('a', { title: 'ノート a', content: '本文 a' });
    localStorage.setItem(
      NOTE_MIGRATION_KEY,
      JSON.stringify({ ...INITIAL_RECORD, backedUpAt: '2026-11-19T00:00:00Z', phase: 'importing' }),
    );
    render(<Harness />);
    expect(screen.queryByText('notes.migration.start')).toBeNull();
    await screen.findByText('notes.migration.doneTitle');
    expect([...server.notes.keys()].sort()).toEqual(['a', 'b']);
    expect(server.creates).toBe(1);
    expect(downloads).toHaveLength(0);
  });

  it('shows a failure with a resume that finishes the move', async () => {
    seedLocal([localNote('a')]);
    server.failNext('fetchManifest');
    render(<Harness />);
    fireEvent.click(screen.getByText('notes.migration.start'));
    await screen.findByText('notes.migration.errorTitle');
    fireEvent.click(screen.getByText('notes.migration.retry'));
    await screen.findByText('notes.migration.doneTitle');
    expect(server.notes.has('a')).toBe(true);
  });

  it('shows nothing when this browser has no notes to move, and records that', () => {
    useNoteStore.setState({ source: 'server' });
    render(<Harness />);
    expect(screen.queryByTestId('note-migration-banner')).toBeNull();
    expect(readMigrationRecord().phase).toBe('done');
  });
});
