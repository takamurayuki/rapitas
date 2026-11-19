/**
 * useNoteMigration
 *
 * The desktop note migration as screen state: whether there is anything to
 * move, the start (backup first), progress, the differences to decide, a
 * failure with a retry, and the switch of the note store to the server once
 * everything is in. A migration that was started resumes by itself the next
 * time the notes page opens (design §5.3 step 6).
 *
 * Not responsible for the steps themselves (note-migration-runner) or for
 * drawing (NoteMigrationBanner).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNoteStore } from '@/stores/note-store';
import { isMeaningfulNote, readLocalNotes } from '@/stores/note/note-local-backup';
import {
  readMigrationRecord,
  writeMigrationRecord,
  type DiffChoice,
  type RejectedLink,
} from '@/stores/note/note-migration-record';
import { httpMigrationApi, type MigrationApi } from './note-migration-api';
import {
  applyDecisions,
  runMigration,
  type RunDeps,
  type RunResult,
} from './note-migration-runner';
import { writeNoteBackup, browserDownload, type Downloader } from './note-migration-backup';
import type { Hasher, MigrationDiff } from './note-migration-plan';

export type MigrationView =
  | { kind: 'hidden' }
  | { kind: 'notStarted'; noteCount: number }
  | { kind: 'running'; imported: number; total: number }
  | { kind: 'needsDecision'; diffs: MigrationDiff[] }
  | { kind: 'error'; message: string }
  | { kind: 'done'; rejectedLinks: RejectedLink[] };

export interface NoteMigrationOptions {
  api?: MigrationApi;
  download?: Downloader;
  hash?: Hasher;
}

export interface NoteMigrationControls {
  view: MigrationView;
  start: () => void;
  apply: (diffs: MigrationDiff[], choices: Record<string, DiffChoice>) => void;
  retry: () => void;
  dismiss: () => void;
}

function initialView(source: 'local' | 'server'): MigrationView {
  if (source === 'server') return { kind: 'hidden' };
  const record = readMigrationRecord();
  if (record.backedUpAt) return { kind: 'running', imported: record.imported, total: 0 };
  const noteCount = readLocalNotes().notes.filter(isMeaningfulNote).length;
  return { kind: 'notStarted', noteCount };
}

/**
 * Drive this browser's note migration.
 *
 * @param options - Injected API, downloader and hash, for tests / テスト用の差し替え
 * @returns The view and its actions / 表示状態と操作
 */
export function useNoteMigration(options: NoteMigrationOptions = {}): NoteMigrationControls {
  const source = useNoteStore((s) => s.source);
  const [view, setView] = useState<MigrationView>(() => initialView(source));
  const busy = useRef(false);
  const api = options.api ?? httpMigrationApi;
  const download = options.download ?? browserDownload;
  const { hash } = options;

  const deps = useCallback(
    (): RunDeps => ({
      api,
      records: { read: readMigrationRecord, write: writeMigrationRecord },
      // Read each time: before the switch the local store is still editable.
      localNotes: readLocalNotes().notes,
      ...(hash ? { hash } : {}),
      onProgress: (record, total) => setView({ kind: 'running', imported: record.imported, total }),
    }),
    [api, hash],
  );

  const handle = useCallback(async (work: () => Promise<RunResult>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const result = await work();
      if (result.status === 'needsDecision') {
        setView({ kind: 'needsDecision', diffs: result.diffs });
        return;
      }
      // Step 7: everything is in; from here the store reads the server.
      await useNoteStore.getState().switchToServer();
      setView({ kind: 'done', rejectedLinks: result.record.rejectedLinks });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeMigrationRecord({ ...readMigrationRecord(), lastError: message });
      setView({ kind: 'error', message });
    } finally {
      busy.current = false;
    }
  }, []);

  const run = useCallback(() => {
    setView((v) => (v.kind === 'running' ? v : { kind: 'running', imported: 0, total: 0 }));
    void handle(() => runMigration(deps()));
  }, [deps, handle]);

  const start = useCallback(() => {
    writeNoteBackup(download);
    writeMigrationRecord({ ...readMigrationRecord(), backedUpAt: new Date().toISOString() });
    run();
  }, [download, run]);

  const apply = useCallback(
    (diffs: MigrationDiff[], choices: Record<string, DiffChoice>) => {
      setView({ kind: 'running', imported: readMigrationRecord().imported, total: 0 });
      void handle(() => applyDecisions(deps(), diffs, choices));
    },
    [deps, handle],
  );

  // Resume a started migration on open; record "nothing to move" as done.
  useEffect(() => {
    const record = readMigrationRecord();
    if (source === 'server') {
      if (record.phase !== 'done') writeMigrationRecord({ ...record, phase: 'done' });
      return;
    }
    if (record.backedUpAt && record.phase !== 'done') run();
    // Once, on mount: later runs are started by the user's actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useMemo(
    () => ({ view, start, apply, retry: run, dismiss: () => setView({ kind: 'hidden' }) }),
    [view, start, apply, run],
  );
}
