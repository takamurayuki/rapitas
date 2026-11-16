/**
 * MobileLinkStore
 *
 * Persists the phone-link state (#1421): whether the LAN gateway is on, this
 * desktop's stable id, and the paired devices with the SHA-256 of their
 * tokens. Lives in `<data dir>/mobile-link.json` rather than the database
 * because it decides who may reach the database at all, and schema changes
 * are avoided for settings (same choice as user-database.json).
 * Not responsible for issuing or checking tokens — see device-token.ts.
 */
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FILE = 'mobile-link.json';

/** Port the LAN gateway listens on; the main API stays on loopback :3001. */
export const DEFAULT_GATEWAY_PORT = 3002;

/** One phone that completed pairing. */
export interface PairedDevice {
  id: string;
  name: string;
  /** Hex SHA-256 of the bearer token; the token itself is never stored. */
  tokenHash: string;
  /** Workspace that was active when it paired; null = unscoped (single-user desktop). */
  workspaceId: number | null;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface MobileLinkState {
  version: 1;
  enabled: boolean;
  /** Stable id the phone uses to recognise this desktop across IP changes. */
  desktopId: string;
  gatewayPort: number;
  devices: PairedDevice[];
}

/** The data dir the backend uses everywhere else. */
export function defaultDataDir(): string {
  return process.env.RAPITAS_DATA_DIR?.trim() || join(homedir(), '.rapitas');
}

function freshState(): MobileLinkState {
  return {
    version: 1,
    enabled: false,
    desktopId: randomUUID(),
    gatewayPort: DEFAULT_GATEWAY_PORT,
    devices: [],
  };
}

function isValidState(value: unknown): value is MobileLinkState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<MobileLinkState>;
  return (
    v.version === 1 &&
    typeof v.enabled === 'boolean' &&
    typeof v.desktopId === 'string' &&
    typeof v.gatewayPort === 'number' &&
    Array.isArray(v.devices)
  );
}

/**
 * A store bound to one directory.
 *
 * @param dir - Directory holding mobile-link.json / 設定ファイルの置き場所
 * @returns read / update operations / 読み書き操作
 */
export function createMobileLinkStore(dir: string = defaultDataDir()) {
  const path = join(dir, FILE);
  let cache: MobileLinkState | null = null;

  const write = (state: MobileLinkState) => {
    mkdirSync(dir, { recursive: true });
    // Write-then-rename so a crash mid-write never leaves a half file that
    // would silently unpair every device (an unparseable file reads as fresh).
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
    try {
      chmodSync(path, 0o600);
    } catch {
      // Windows ignores POSIX modes; the file is still under the user's profile.
    }
    cache = state;
  };

  const read = (): MobileLinkState => {
    if (cache) return cache;
    if (existsSync(path)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (isValidState(parsed)) {
          cache = parsed;
          return parsed;
        }
      } catch {
        // fall through to a fresh state
      }
    }
    // Persist immediately so desktopId stays stable from the first read on.
    const fresh = freshState();
    write(fresh);
    return fresh;
  };

  return {
    read,
    /**
     * Apply a change and persist it.
     *
     * @param change - Returns the next state / 次の状態を返す関数
     * @returns The persisted state / 保存後の状態
     */
    update(change: (state: MobileLinkState) => MobileLinkState): MobileLinkState {
      const next = change(structuredClone(read()));
      write(next);
      return next;
    },
  };
}

export type MobileLinkStore = ReturnType<typeof createMobileLinkStore>;
