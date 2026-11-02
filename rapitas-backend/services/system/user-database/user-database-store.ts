/**
 * user-database-store
 *
 * Persists which database the user chose (#1285): a secret reference (OS
 * keychain, or encrypted text) in `<data dir>/user-database.json`, plus when
 * it was initialized. It cannot live in the database — it is read at boot to
 * decide which database to open. Synchronous, because that read happens
 * before anything else loads (config/user-database-override.ts).
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FILE = 'user-database.json';
/** Keychain account the connection string is stored under. */
export const USER_DATABASE_SECRET_ACCOUNT = 'user-database-url';

/** How secrets are written and read — the real secret-store, or a test double. */
export interface SecretOps {
  save(account: string, secret: string): string;
  resolve(ref: string | null | undefined): string | null;
  remove(ref: string | null | undefined): void;
}

/** What a configured user database looks like once read back. */
export interface UserDatabaseRecord {
  url: string;
  /** ISO time the schema was applied, or null when not yet initialized. */
  initializedAt: string | null;
}

interface FileShape {
  secretRef: string;
  initializedAt: string | null;
}

/** The data dir the backend uses everywhere else. */
export function defaultDataDir(): string {
  return process.env.RAPITAS_DATA_DIR?.trim() || join(homedir(), '.rapitas');
}

/**
 * A store bound to one directory and one secret backend.
 *
 * @param dir - Directory holding user-database.json / 設定ファイルの置き場所
 * @param secrets - Secret storage / 秘密情報の保存先
 * @returns read / save / markInitialized / clear / 操作一式
 */
export function createUserDatabaseStore(dir: string, secrets: SecretOps) {
  const path = join(dir, FILE);
  const readFile = (): FileShape | null => {
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as FileShape;
    } catch {
      return null;
    }
  };
  const writeFile = (data: FileShape) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  };
  return {
    read(): UserDatabaseRecord | null {
      const f = readFile();
      if (!f?.secretRef) return null;
      const url = secrets.resolve(f.secretRef);
      // A reference whose secret is gone (keychain wiped) is no configuration.
      return url ? { url, initializedAt: f.initializedAt ?? null } : null;
    },
    /** Store a URL. A new URL is a different database: not initialized yet. */
    save(url: string): void {
      const previous = readFile();
      if (previous?.secretRef) secrets.remove(previous.secretRef);
      writeFile({
        secretRef: secrets.save(USER_DATABASE_SECRET_ACCOUNT, url),
        initializedAt: null,
      });
    },
    markInitialized(at: Date = new Date()): void {
      const f = readFile();
      if (f) writeFile({ ...f, initializedAt: at.toISOString() });
    },
    clear(): void {
      const f = readFile();
      if (f?.secretRef) secrets.remove(f.secretRef);
      if (existsSync(path)) unlinkSync(path);
    },
  };
}
