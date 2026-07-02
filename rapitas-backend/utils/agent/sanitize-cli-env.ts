/**
 * SanitizeCliEnv
 *
 * Builds a spawn-safe environment for CLI-based coding agents (Claude Code,
 * Gemini CLI, …) by removing secrets from the inherited process env. Not
 * responsible for CLI path resolution or process lifecycle.
 */

// NOTE: The agent CLI is prompt-steerable (it can be asked to print its own
// env, write it to a file, or exfiltrate it via a tool call), so any secret
// present in `process.env` at spawn time is effectively readable by whatever
// the task prompt says. Denylist (not allowlist) so we never accidentally
// drop a variable the CLI itself needs to function (PATH, HOME, ANTHROPIC_*
// auth, git config, etc.) while still stripping everything sensitive.
const SENSITIVE_ENV_KEY_PATTERN =
  /(SECRET|ENCRYPTION|_TOKEN|API_KEY|PASSWORD|PRIVATE_KEY|DATABASE_URL|CREDENTIAL)/i;

// Exact-name denylist for keys that don't match the pattern above but are
// still sensitive (or would otherwise false-positive-survive it).
const SENSITIVE_ENV_KEYS = new Set(['ENCRYPTION_KEY', 'DATABASE_URL', 'DIRECT_DATABASE_URL']);

// Never strip these even if they match the pattern above — the CLI itself
// authenticates with them (subscription OR API-key mode, depending on how
// the operator has it configured). Only the aux-AI CLI path deliberately
// strips these to force subscription billing; the main agent runner must
// not silently break API-key-based deployments.
const ALWAYS_KEEP_PREFIXES = ['ANTHROPIC_'];

/**
 * Returns a copy of `process.env` with secrets removed, suitable for passing
 * as the `env` option to a spawned agent CLI process.
 *
 * @param overrides - Additional env vars to set/override after sanitizing (e.g. FORCE_COLOR) / サニタイズ後に上書きする追加環境変数
 * @returns Sanitized environment object / サニタイズ済み環境変数オブジェクト
 */
export function buildSanitizedSpawnEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (ALWAYS_KEEP_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    if (SENSITIVE_ENV_KEYS.has(key) || SENSITIVE_ENV_KEY_PATTERN.test(key)) {
      delete env[key];
    }
  }
  return { ...env, ...overrides };
}
