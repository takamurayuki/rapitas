/**
 * RapiProfileBackfill
 *
 * One-shot startup task that moves the pre-#1275 self-introduction files
 * (`~/.rapitas/.rapi-profile` and `.rapi-character`) onto the settings row
 * the profile lives on now.
 *
 * It only ever seeds the LOWEST `UserSettings` id, and only a column that is
 * still empty. Both halves matter. "Lowest id" is the row that existed
 * before tenancy — the person who wrote the files — and it is what stops a
 * later boot from handing those files to an account created after the move.
 * "Still empty" makes the task idempotent and keeps it from overwriting
 * something rewritten through the settings page.
 *
 * The files are left on disk: deleting them is irreversible, and nothing
 * reads them once the columns are filled.
 *
 * Not responsible for reading or writing the profile in normal operation —
 * that is rapi-profile-store.ts.
 */
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { MAX_RAPI_PROFILE_LENGTH, type SettingsDelegate } from './rapi-profile-store';

const log = createLogger('system:rapi-profile-backfill');

/** Which file held which column before the move. */
const LEGACY_FILES: Record<'rapiProfile' | 'rapiCharacter', string> = {
  rapiProfile: '.rapi-profile',
  rapiCharacter: '.rapi-character',
};

function dataDir(): string {
  return process.env.RAPITAS_DATA_DIR?.trim() || join(homedir(), '.rapitas');
}

/**
 * Read one legacy file, bounded and trimmed the way a save would bound it.
 *
 * @param name - File name inside the data directory / データディレクトリ内のファイル名
 * @returns Its content, or null when absent or blank / 内容（無い・空なら null）
 */
function readLegacyFile(name: string): string | null {
  try {
    const trimmed = readFileSync(join(dataDir(), name), 'utf8').trim();
    return trimmed ? trimmed.slice(0, MAX_RAPI_PROFILE_LENGTH) : null;
  } catch {
    return null;
  }
}

/**
 * Copy whatever the files still hold onto the oldest settings row.
 *
 * Never throws: this runs in the start-up warm-up list, and the backend is
 * how the agent reaches itself.
 *
 * @param delegate - Settings delegate; defaults to the live one / 設定デリゲート（既定は本番）
 * @returns How many columns were filled; 0 when there was nothing to do / 埋めた列数（不要なら 0）
 */
export async function backfillRapiProfileToDatabase(
  delegate: SettingsDelegate = prisma.userSettings as unknown as SettingsDelegate,
): Promise<number> {
  try {
    const legacy: Record<string, string> = {};
    for (const [field, name] of Object.entries(LEGACY_FILES)) {
      const value = readLegacyFile(name);
      if (value) legacy[field] = value;
    }
    if (Object.keys(legacy).length === 0) return 0;

    // Unscoped on purpose: there is no workspace context during warm-up, so
    // the extension passes this through and the lowest id really is the
    // oldest row in the install.
    const row = await delegate.findFirst({ orderBy: { id: 'asc' } });
    if (!row) return 0;

    const data: Record<string, string> = {};
    for (const [field, value] of Object.entries(legacy)) {
      const current = row[field as 'rapiProfile' | 'rapiCharacter'];
      if (typeof current === 'string' && current.trim()) continue;
      data[field] = value;
    }
    if (Object.keys(data).length === 0) return 0;

    await delegate.update({ where: { id: row.id }, data });
    log.info(
      { settingsId: row.id, fields: Object.keys(data) },
      'moved the self-introduction onto its account',
    );
    return Object.keys(data).length;
  } catch (err) {
    log.warn({ err }, 'could not move the self-introduction onto its account');
    return 0;
  }
}
