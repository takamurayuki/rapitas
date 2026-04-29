/**
 * Backup Service
 *
 * Creates encrypted local archives of the application database. Provider-aware:
 *   - PostgreSQL: streams `pg_dump` output through AES-256-GCM into a file.
 *   - SQLite:     uses `VACUUM INTO` for a consistent snapshot, then encrypts.
 *
 * Output: ~/.rapitas/backups/rapitas-<ISO>.dump.enc
 * Retention: keeps the newest N (default 8) and deletes older ones.
 *
 * The encryption key is the master key resolved by encryption-key-resolver,
 * so a backup file can only be decrypted by the same install (or by anyone
 * who explicitly exports/imports the master key from the OS keychain).
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn as nodeSpawn } from 'child_process';
import { createLogger } from '../../config/logger';
import { resolveEncryptionKey } from '../../utils/common/encryption-key-resolver';

const log = createLogger('backup-service');

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const FILE_MAGIC = Buffer.from('RAPITASBKv1\0');

export interface BackupRecord {
  filename: string;
  fullPath: string;
  sizeBytes: number;
  createdAt: Date;
  provider: 'postgresql' | 'sqlite' | 'unknown';
}

export interface BackupRunResult {
  success: boolean;
  record?: BackupRecord;
  error?: string;
  durationMs: number;
}

/** Default retention — keep the newest N backups. */
const DEFAULT_RETENTION = 8;

/** Resolve the directory where backup archives live. Created on first call. */
export function backupDir(): string {
  return path.join(os.homedir(), '.rapitas', 'backups');
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function detectProvider(): 'postgresql' | 'sqlite' | 'unknown' {
  if (
    process.env.RAPITAS_DB_PROVIDER === 'sqlite' ||
    process.env.DATABASE_URL?.startsWith('file:')
  ) {
    return 'sqlite';
  }
  if (process.env.DATABASE_URL?.startsWith('postgres')) return 'postgresql';
  return 'unknown';
}

function timestampForFilename(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

/**
 * Encrypt a stream using AES-256-GCM and write to disk with a small header
 * format: MAGIC | IV (12) | AUTH_TAG (16) | CIPHERTEXT.
 *
 * Auth tag is stored AFTER ciphertext is finalized, so we write a placeholder
 * then patch it. Using fs.openSync/writeSync to keep control of byte layout.
 */
async function encryptStreamToFile(
  source: NodeJS.ReadableStream,
  outPath: string,
  keyHex: string,
): Promise<void> {
  const key = Buffer.from(keyHex.slice(0, 64), 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);

  const fd = fs.openSync(outPath, 'w');
  try {
    fs.writeSync(fd, FILE_MAGIC);
    fs.writeSync(fd, iv);
    // Reserve 16 bytes for the auth tag — we patch it once cipher is finalized.
    const tagOffset = FILE_MAGIC.length + IV_LENGTH;
    fs.writeSync(fd, Buffer.alloc(16));

    await new Promise<void>((resolve, reject) => {
      cipher.on('data', (chunk: Buffer) => fs.writeSync(fd, chunk));
      cipher.on('end', resolve);
      cipher.on('error', reject);
      source.on('error', reject);
      source.pipe(cipher);
    });

    const tag = cipher.getAuthTag();
    fs.writeSync(fd, tag, 0, tag.length, tagOffset);
  } finally {
    fs.closeSync(fd);
  }
}

async function backupPostgres(outPath: string): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is not set');

  const proc = nodeSpawn('pg_dump', ['--format=custom', '--no-owner', dbUrl], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  proc.stderr?.on('data', (c) => {
    stderr += c.toString();
  });

  const exit = new Promise<number>((resolve, reject) => {
    proc.on('error', reject);
    proc.on('exit', (code) => resolve(code ?? -1));
  });

  await encryptStreamToFile(proc.stdout!, outPath, resolveEncryptionKey());

  const code = await exit;
  if (code !== 0) {
    throw new Error(`pg_dump exited ${code}: ${stderr.slice(0, 500)}`);
  }
}

async function backupSqlite(outPath: string): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl?.startsWith('file:')) throw new Error('Expected file: DATABASE_URL for SQLite');
  const dbPath = path.resolve(dbUrl.replace(/^file:/, ''));
  if (!fs.existsSync(dbPath)) throw new Error(`SQLite database not found: ${dbPath}`);

  // VACUUM INTO produces a consistent copy without locking writers for long.
  const { Database } = await import('bun:sqlite');
  const tmpPath = `${outPath}.tmp.sqlite`;

  const src = new Database(dbPath);
  try {
    src.exec(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }

  try {
    const stream = fs.createReadStream(tmpPath);
    await encryptStreamToFile(stream, outPath, resolveEncryptionKey());
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

/**
 * Run a backup now and persist the encrypted archive.
 *
 * @returns Run result including the resulting record on success.
 */
export async function runBackup(): Promise<BackupRunResult> {
  const start = Date.now();
  const provider = detectProvider();
  const dir = backupDir();
  ensureDir(dir);

  const filename = `rapitas-${timestampForFilename(new Date())}.dump.enc`;
  const fullPath = path.join(dir, filename);

  try {
    if (provider === 'postgresql') {
      await backupPostgres(fullPath);
    } else if (provider === 'sqlite') {
      await backupSqlite(fullPath);
    } else {
      throw new Error('Unsupported DB provider for backup');
    }

    const stat = fs.statSync(fullPath);
    const record: BackupRecord = {
      filename,
      fullPath,
      sizeBytes: stat.size,
      createdAt: stat.mtime,
      provider,
    };

    pruneOldBackups(DEFAULT_RETENTION);
    writeStatus({ lastRunAt: new Date(), lastResult: 'success', lastFilename: filename });

    log.info({ filename, sizeBytes: stat.size, provider }, 'Backup completed');
    return { success: true, record, durationMs: Date.now() - start };
  } catch (err) {
    fs.rmSync(fullPath, { force: true });
    const message = err instanceof Error ? err.message : String(err);
    writeStatus({ lastRunAt: new Date(), lastResult: 'failed', lastError: message });
    log.error({ err }, 'Backup failed');
    return { success: false, error: message, durationMs: Date.now() - start };
  }
}

/** List existing backup archives, newest first. */
export function listBackups(): BackupRecord[] {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  const provider = detectProvider();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.dump.enc'))
    .map((filename) => {
      const fullPath = path.join(dir, filename);
      const stat = fs.statSync(fullPath);
      return {
        filename,
        fullPath,
        sizeBytes: stat.size,
        createdAt: stat.mtime,
        provider,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Delete backups beyond the retention window. */
export function pruneOldBackups(keep: number): void {
  const records = listBackups();
  for (const old of records.slice(keep)) {
    try {
      fs.rmSync(old.fullPath, { force: true });
      log.info({ filename: old.filename }, 'Pruned old backup');
    } catch (err) {
      log.warn({ err, filename: old.filename }, 'Failed to prune backup');
    }
  }
}

interface BackupStatus {
  lastRunAt: Date | null;
  lastResult: 'success' | 'failed' | null;
  lastFilename?: string;
  lastError?: string;
}

function statusFile(): string {
  return path.join(backupDir(), '.status.json');
}

function writeStatus(s: BackupStatus): void {
  ensureDir(backupDir());
  try {
    fs.writeFileSync(statusFile(), JSON.stringify(s, null, 2));
  } catch (err) {
    log.warn({ err }, 'Failed to write backup status file');
  }
}

/** Read the persisted backup status. Empty object if no run has happened. */
export function readBackupStatus(): BackupStatus {
  try {
    const raw = fs.readFileSync(statusFile(), 'utf8');
    const parsed = JSON.parse(raw) as { lastRunAt?: string } & Omit<BackupStatus, 'lastRunAt'>;
    return {
      lastRunAt: parsed.lastRunAt ? new Date(parsed.lastRunAt) : null,
      lastResult: parsed.lastResult ?? null,
      lastFilename: parsed.lastFilename,
      lastError: parsed.lastError,
    };
  } catch {
    return { lastRunAt: null, lastResult: null };
  }
}
