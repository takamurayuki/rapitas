/**
 * DependencyPreflight
 *
 * Refuses a self-deploy pull when dev.js could not reinstall the dependencies
 * it brings in. After the pull, exit 75 hands over to dev.js, which syncs
 * node_modules to the lockfiles with the pinned toolchain
 * (rapitas-desktop/scripts/dep-sync.cjs) and refuses to start the backend if
 * that fails. Checking the one precondition that can be known up front here —
 * the bun on PATH is the pinned bun — keeps a pull from landing the system in
 * that refused state. Not responsible for installing anything.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../../../config/logger';
import { createNotification } from '../../communication/notification-service';

const logger = createLogger('auto-restart-merged-code:deps');

/** The lockfiles dev.js keeps node_modules in step with (repo-relative). */
export const DEPENDENCY_LOCKFILES: readonly string[] = [
  'package-lock.json',
  'rapitas-backend/bun.lock',
  'rapitas-frontend/pnpm-lock.yaml',
  'rapitas-desktop/pnpm-lock.yaml',
];

const BUN_LOCKFILE = 'rapitas-backend/bun.lock';

/** Named refusal, in the same vocabulary as the deploy gates. */
export type DependencyBlocker = 'dependency-toolchain-mismatch';

/**
 * Read the pinned bun version from .github/toolchain.json.
 *
 * @returns Pinned version, or null when unreadable / 固定バージョン（読めなければnull）
 */
export function readPinnedBunVersion(): string | null {
  try {
    const file = join(import.meta.dir, '..', '..', '..', '..', '.github', 'toolchain.json');
    const pin = JSON.parse(readFileSync(file, 'utf8')).bun;
    return typeof pin === 'string' ? pin : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether a change set can be activated with the installed toolchain.
 * Only bun.lock depends on PATH: pnpm runs as `npx pnpm@<pin>` and the root
 * lockfile installs with `npm ci`.
 *
 * @param changedPaths - Paths changed by the pending pull / 取り込む変更のパス
 * @param runningBun - The bun this process (and dev.js's installer) uses / 実行中のbun
 * @param pinnedBun - The pin, null when unknown / 固定バージョン
 * @returns The blocker, or null when safe / 阻害理由、なければnull
 */
export function checkDependencyToolchain(
  changedPaths: readonly string[],
  runningBun: string,
  pinnedBun: string | null,
): DependencyBlocker | null {
  if (!changedPaths.includes(BUN_LOCKFILE)) return null;
  return pinnedBun !== null && runningBun === pinnedBun ? null : 'dependency-toolchain-mismatch';
}

/** Last refusal notified, so a 15-minute poll does not repeat it. */
let lastNotifiedKey: string | null = null;

/**
 * Gate used right before the fast-forward: logs and notifies (once per
 * distinct situation) when the pull must not happen.
 *
 * @param changedPaths - Paths changed by the pending pull / 取り込む変更のパス
 * @returns The blocker, or null when safe / 阻害理由、なければnull
 */
export async function dependencyGate(
  changedPaths: readonly string[],
): Promise<DependencyBlocker | null> {
  const pinned = readPinnedBunVersion();
  const blocker = checkDependencyToolchain(changedPaths, Bun.version, pinned);
  if (!blocker) return null;
  logger.warn(
    { reason: blocker, runningBun: Bun.version, pinnedBun: pinned },
    'deploy refused: bun.lock changed but the bun on PATH is not the pinned version',
  );
  const key = `${Bun.version}:${pinned}`;
  if (lastNotifiedKey !== key) {
    lastNotifiedKey = key;
    await createNotification({
      type: 'system',
      title: 'デプロイ保留: bun のバージョン不一致',
      message: `bun.lock の更新を反映するには bun ${pinned ?? '(不明)'} が必要です（現在 ${Bun.version}）。.github/toolchain.json の版を入れてから再起動してください。`,
    }).catch((err) => logger.warn({ err }, 'notification failed'));
  }
  return blocker;
}
