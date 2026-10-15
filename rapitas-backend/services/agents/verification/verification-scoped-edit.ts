/**
 * verification-scoped-edit
 *
 * Lets a verifier temporarily mutate an EXISTING file in the task's own live
 * worktree (e.g. `git checkout -- <file>` to remove a reproduction test) and
 * restore it afterwards without destroying an implementer's uncommitted
 * changes to the same file — the task-913 incident this module exists to
 * prevent. Unlike red-state-check.ts (which never touches the live
 * worktree), this is for cases where the live, uncommitted state must
 * actually be edited in place. Snapshots are Buffer-based (no text
 * conversion) so line endings and non-UTF-8 encodings survive byte-for-byte,
 * and are persisted outside the worktree (`RAPITAS_DATA_DIR`) so a killed
 * process leaves durable evidence instead of losing the pre-edit state.
 * Restoration re-checks each file's current hash against the hash right
 * after the caller's mutation; a mismatch means someone else edited the
 * file in between, so that file is left untouched and reported instead of
 * silently overwritten. Not responsible for deciding WHEN a temporary edit
 * is needed, or for wiring itself into any verification call site — see
 * completion-gate.ts's hasUnresolvedScopedEdit for the failure-mode backstop.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../../../config/logger';

const log = createLogger('agents:verification:verification-scoped-edit');

/** One target file's pre-edit state, as persisted in the manifest. */
interface ScopedEditManifestEntry {
  relPath: string;
  existedBefore: boolean;
  beforeHash: string | null;
  /** Base64 of the original bytes; null when the file did not exist before. */
  beforeContentBase64: string | null;
  /**
   * Hash observed by the most recent assertSafeToMutate call, right before
   * the caller's own mutation — distinct in time from beforeHash (snapshot
   * time) and from the caller-supplied afterMutateHash (after the caller's
   * own mutation). Never used as a substitute for either.
   */
  preMutateHash: string | null;
  /** ISO timestamp of the last assertSafeToMutate mismatch, or null. */
  concurrentEditDetectedAt: string | null;
}

interface ScopedEditManifest {
  taskId: number;
  worktreePath: string;
  entries: ScopedEditManifestEntry[];
}

/** Public summary of a started scoped edit, returned to the caller. */
export interface ScopedEditHandle {
  manifestPath: string;
  taskId: number;
  worktreePath: string;
  entries: { relPath: string; existedBefore: boolean; beforeHash: string | null }[];
}

/** Outcome of attempting to restore a scoped edit. */
export type ScopedEditRestoreResult =
  | { restored: true }
  | {
      restored: false;
      reason: 'concurrent_edit_detected' | 'process_error';
      conflictingFiles: string[];
      evidencePath: string;
    };

/**
 * Outcome of checking whether it is safe to apply the caller's temporary
 * mutation. `preMutateHashes` is informational only (the hash observed at
 * check time) — it is NOT the value to pass as restoreScopedEdit's
 * afterMutateHash, which must be computed by the caller AFTER its own
 * mutation.
 */
export type AssertSafeToMutateResult =
  | { safe: true; preMutateHashes: Record<string, string | null> }
  | {
      safe: false;
      reason: 'concurrent_edit_detected_before_mutate';
      conflictingFiles: string[];
    };

/** Directory holding scoped-edit manifests (override via RAPITAS_DATA_DIR). */
function getScopeDir(): string {
  const override = process.env.RAPITAS_DATA_DIR;
  const base = override && override.trim().length > 0 ? override : join(homedir(), '.rapitas');
  return join(base, 'verification-scope');
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function readManifest(manifestPath: string): ScopedEditManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as ScopedEditManifest;
}

/**
 * Snapshots `targetFiles`' current bytes from `worktreePath` (whatever state
 * they are in, including an implementer's uncommitted edits) and persists
 * the snapshot to a manifest outside the worktree. Throws (fail-closed) if
 * the manifest cannot be written — a caller that cannot obtain a safety net
 * must not proceed with the temporary mutation either.
 *
 * @param worktreePath - The task's live git worktree. / タスクのライブworktree
 * @param taskId - Task id the scoped edit belongs to. / タスクID
 * @param targetFiles - Repo-relative paths to snapshot before mutating. / スナップショット対象の相対パス
 * @returns A handle referencing the persisted manifest. / 永続化されたmanifestへの参照
 * @throws {Error} When the manifest cannot be written to disk. / manifest書き込み失敗時
 */
export async function beginScopedEdit(
  worktreePath: string,
  taskId: number,
  targetFiles: string[],
): Promise<ScopedEditHandle> {
  const entries: ScopedEditManifestEntry[] = targetFiles.map((relPath) => {
    const abs = join(worktreePath, relPath);
    if (!existsSync(abs)) {
      return {
        relPath,
        existedBefore: false,
        beforeHash: null,
        beforeContentBase64: null,
        preMutateHash: null,
        concurrentEditDetectedAt: null,
      };
    }
    const content = readFileSync(abs);
    return {
      relPath,
      existedBefore: true,
      beforeHash: sha256(content),
      beforeContentBase64: content.toString('base64'),
      preMutateHash: null,
      concurrentEditDetectedAt: null,
    };
  });

  const scopeDir = getScopeDir();
  mkdirSync(scopeDir, { recursive: true });
  const manifestId = randomBytes(6).toString('hex');
  const manifestPath = join(scopeDir, `${taskId}-${manifestId}.json`);
  const manifest: ScopedEditManifest = { taskId, worktreePath, entries };
  writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');

  return {
    manifestPath,
    taskId,
    worktreePath,
    entries: entries.map(({ relPath, existedBefore, beforeHash }) => ({
      relPath,
      existedBefore,
      beforeHash,
    })),
  };
}

/**
 * Checks whether it is safe for the caller to apply its own temporary
 * mutation now, by re-reading every target file and comparing its current
 * hash against `beforeHash` (the snapshot taken by `beginScopedEdit`). This
 * closes the window `beginScopedEdit` cannot see on its own: an
 * implementer's edit made AFTER the snapshot but BEFORE the verifier's own
 * mutation. Must be called immediately before applying the mutation — a
 * mismatch means someone else has already changed the file, and the caller
 * MUST NOT proceed with the mutation (this function only detects; it cannot
 * stop the caller from mutating anyway). On mismatch, the manifest is kept
 * on disk (not deleted) with `concurrentEditDetectedAt` recorded per
 * conflicting file, so the incident is not silently discarded.
 *
 * @param handle - The handle returned by beginScopedEdit. / beginScopedEditが返したハンドル
 * @returns `safe: true` with informational pre-mutate hashes, or `safe: false` naming the files that changed since the snapshot. / 安全性判定
 */
export async function assertSafeToMutate(
  handle: ScopedEditHandle,
): Promise<AssertSafeToMutateResult> {
  const manifest = readManifest(handle.manifestPath);
  const conflictingFiles: string[] = [];
  const preMutateHashes: Record<string, string | null> = {};

  for (const entry of manifest.entries) {
    const abs = join(manifest.worktreePath, entry.relPath);
    const currentHash = existsSync(abs) ? sha256(readFileSync(abs)) : null;
    preMutateHashes[entry.relPath] = currentHash;
    if (currentHash !== entry.beforeHash) conflictingFiles.push(entry.relPath);
  }

  if (conflictingFiles.length > 0) {
    const detectedAt = new Date().toISOString();
    manifest.entries = manifest.entries.map((entry) =>
      conflictingFiles.includes(entry.relPath)
        ? {
            ...entry,
            preMutateHash: preMutateHashes[entry.relPath],
            concurrentEditDetectedAt: detectedAt,
          }
        : entry,
    );
    writeFileSync(handle.manifestPath, JSON.stringify(manifest), 'utf8');
    log.warn(
      { manifestPath: handle.manifestPath, conflictingFiles },
      '[verification-scoped-edit] concurrent edit detected before mutation — do not proceed',
    );
    return { safe: false, reason: 'concurrent_edit_detected_before_mutate', conflictingFiles };
  }

  manifest.entries = manifest.entries.map((entry) => ({
    ...entry,
    preMutateHash: preMutateHashes[entry.relPath],
  }));
  writeFileSync(handle.manifestPath, JSON.stringify(manifest), 'utf8');
  return { safe: true, preMutateHashes };
}

/**
 * Restores the files captured by `beginScopedEdit` to their pre-edit bytes,
 * but only when each file's current content matches `afterMutateHash`, the
 * hash the caller computed right after its own temporary mutation. A
 * mismatch on any file aborts restoration for that file only and the
 * manifest is kept on disk as evidence — never silently overwritten.
 *
 * @param handle - The handle returned by beginScopedEdit. / beginScopedEditが返したハンドル
 * @param afterMutateHash - Per-file sha256 hex hash the caller MUST compute right after its own temporary mutation, keyed by relPath. Required — this is what restoration is checked against; it is a different point in time from assertSafeToMutate's preMutateHashes and must not be substituted with it. / 呼び出し元の一時変更直後のファイル別ハッシュ（必須）
 * @returns Whether restoration succeeded, with evidence on failure. / 復元成否と失敗時の証拠
 */
export async function restoreScopedEdit(
  handle: ScopedEditHandle,
  afterMutateHash: Record<string, string>,
): Promise<ScopedEditRestoreResult> {
  let manifest: ScopedEditManifest;
  try {
    manifest = readManifest(handle.manifestPath);
  } catch (err) {
    log.warn(
      { err, manifestPath: handle.manifestPath },
      '[verification-scoped-edit] manifest unreadable',
    );
    return {
      restored: false,
      reason: 'process_error',
      conflictingFiles: [],
      evidencePath: handle.manifestPath,
    };
  }

  const conflictingFiles: string[] = [];
  for (const entry of manifest.entries) {
    const abs = join(manifest.worktreePath, entry.relPath);
    const expectedHash = afterMutateHash[entry.relPath];
    const currentExists = existsSync(abs);
    const currentHash = currentExists ? sha256(readFileSync(abs)) : null;
    if (expectedHash !== currentHash) {
      conflictingFiles.push(entry.relPath);
    }
  }

  if (conflictingFiles.length > 0) {
    log.warn(
      { manifestPath: handle.manifestPath, conflictingFiles },
      '[verification-scoped-edit] concurrent edit detected — restore aborted',
    );
    return {
      restored: false,
      reason: 'concurrent_edit_detected',
      conflictingFiles,
      evidencePath: handle.manifestPath,
    };
  }

  for (const entry of manifest.entries) {
    const abs = join(manifest.worktreePath, entry.relPath);
    if (entry.existedBefore && entry.beforeContentBase64 != null) {
      writeFileSync(abs, Buffer.from(entry.beforeContentBase64, 'base64'));
    } else if (!entry.existedBefore && existsSync(abs)) {
      unlinkSync(abs);
    }
  }

  unlinkSync(handle.manifestPath);
  return { restored: true };
}

/**
 * Whether `taskId` has at least one scoped-edit manifest still on disk — a
 * temporary mutation that was never successfully restored (concurrent-edit
 * abort, or the process crashed/was killed before `restoreScopedEdit` ran).
 * Used by completion-gate.ts to keep the completion gate closed until a
 * human resolves the leftover manifest.
 *
 * @param taskId - Task id to check. / 確認するタスクID
 * @returns true when an unresolved manifest exists for this task. / 未解決manifestが存在すればtrue
 */
export function hasUnresolvedScopedEdit(taskId: number): boolean {
  const scopeDir = getScopeDir();
  if (!existsSync(scopeDir)) return false;
  const prefix = `${taskId}-`;
  try {
    return readdirSync(scopeDir).some((name) => name.startsWith(prefix) && name.endsWith('.json'));
  } catch (err) {
    log.warn(
      { err, scopeDir },
      '[verification-scoped-edit] failed to list scope dir — assuming none',
    );
    return false;
  }
}
