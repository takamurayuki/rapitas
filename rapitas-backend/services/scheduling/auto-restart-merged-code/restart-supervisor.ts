/**
 * restart-supervisor
 *
 * Answers "will something relaunch this backend if it exits 75?", which both
 * self-restart paths must know before exiting. Not responsible for restarting.
 */

/** Env var that declares a restart supervisor exists outside a Tauri build. */
export const RESTART_SUPERVISOR_ENV = 'RAPITAS_RESTART_SUPERVISED';

/**
 * Whether a supervisor relaunches this process after an exit-75 restart.
 *
 * `TAURI_BUILD=true` is set by dev.js and backend-wrapper.ps1, which do relaunch.
 * It is only a proxy, though: `bun run dev:stable` is relaunched too but sets
 * nothing, so with TAURI_BUILD alone `autoRestartOnMergedCode` had no effect at
 * all and merged code sat unactivated for hours (#1132). Such runs opt in with
 * `RAPITAS_RESTART_SUPERVISED=true`. Without either, exiting would orphan the
 * backend, so callers must stay put.
 *
 * @param env - Environment to read (injectable for tests) / 参照する環境変数
 * @returns true when an exit-75 restart will be relaunched / 再起動後に再起動されるならtrue
 */
export function hasRestartSupervisor(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TAURI_BUILD === 'true' || env[RESTART_SUPERVISOR_ENV] === 'true';
}
