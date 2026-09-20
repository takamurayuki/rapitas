/**
 * agent-guard-settings
 *
 * Writes the settings file that explicitly injects the primary-checkout PreToolUse
 * hook into spawned Claude CLI runs (--settings). Not responsible for the hook's
 * decision logic (see scripts/primary-guard-hook.cjs).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// NOTE: rapitas-backend/services/agents/claude-code → repo root is four levels up. The hook is
// resolved from the running backend's checkout so worktrees branched before the hook existed
// (no scripts/primary-guard-hook.cjs of their own) are still covered.
const HOOK_SCRIPT = resolve(import.meta.dir, '../../../../scripts/primary-guard-hook.cjs');

/**
 * Ensure the guard settings file exists and return its path.
 *
 * @returns Absolute settings path, or null when the hook script is unavailable / 設定ファイルのパス（フック不在時は null）
 */
export function ensureGuardSettingsFile(): string | null {
  if (!existsSync(HOOK_SCRIPT)) return null;
  try {
    const dir = join(tmpdir(), 'rapitas-agent-guard');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash|PowerShell',
              hooks: [{ type: 'command', command: `node "${HOOK_SCRIPT}"`, timeout: 5 }],
            },
          ],
        },
      }),
    );
    return file;
  } catch {
    return null; // Best-effort: the denylist and project settings remain as fallbacks.
  }
}
