/**
 * note-migration-backup
 *
 * Step 1 of the migration (design §5.3): before anything is sent, the
 * browser's note store is written out as a JSON file the user downloads.
 * Not responsible for the store itself, which is left in place as a
 * read-only backup.
 */
import { LOCAL_NOTE_STORAGE_KEY } from '@/stores/note/note-local-backup';

/** What triggers a download; injected for tests (jsdom has no downloads). */
export type Downloader = (fileName: string, json: string) => void;

/** Save a file through a temporary link, the way the browser downloads one. */
export const browserDownload: Downloader = (fileName, json) => {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

/**
 * Write the raw `note-storage` entry to a dated JSON file.
 *
 * The raw entry rather than the parsed notes: if anything about the
 * migration is wrong, this file is what a person restores from.
 *
 * @param download - How to hand the file to the user / ファイルの渡し方
 * @param now - Clock, for tests / 時刻（テスト用）
 * @returns The file name / ファイル名
 */
export function writeNoteBackup(
  download: Downloader = browserDownload,
  now: () => Date = () => new Date(),
): string {
  const raw = window.localStorage.getItem(LOCAL_NOTE_STORAGE_KEY);
  const at = now();
  const fileName = `rapitas-notes-backup-${at.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  const json = JSON.stringify(
    {
      exportedAt: at.toISOString(),
      storageKey: LOCAL_NOTE_STORAGE_KEY,
      data: raw ? (JSON.parse(raw) as unknown) : null,
    },
    null,
    2,
  );
  download(fileName, json);
  return fileName;
}
