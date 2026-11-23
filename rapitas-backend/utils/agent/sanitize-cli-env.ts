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

// NOTE: Not secret, but rapitas's own run mode: rapitas-backend/.env sets
// NODE_ENV=development and Bun loads it into process.env, so every agent and
// every app under test inherited it and another project's `next build` failed
// (concern #14840, task 1523; 2026-11-22). The project picks its own mode.
const BACKEND_RUNTIME_KEYS = new Set(['NODE_ENV']);

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
 * @param extraKeepPrefixes - Additional prefixes to never strip, on top of ALWAYS_KEEP_PREFIXES —
 *   for CLIs (Codex/Gemini) that authenticate via their own provider env vars
 *   (OPENAI_*, GEMINI_*, GOOGLE_*) rather than ANTHROPIC_*. / 追加で保持する接頭辞
 * @returns Sanitized environment object / サニタイズ済み環境変数オブジェクト
 */
export function buildSanitizedSpawnEnv(
  overrides: NodeJS.ProcessEnv = {},
  extraKeepPrefixes: string[] = [],
): NodeJS.ProcessEnv {
  const keepPrefixes = [...ALWAYS_KEEP_PREFIXES, ...extraKeepPrefixes];
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (keepPrefixes.some((prefix) => key.startsWith(prefix))) continue;
    if (
      SENSITIVE_ENV_KEYS.has(key) ||
      BACKEND_RUNTIME_KEYS.has(key) ||
      SENSITIVE_ENV_KEY_PATTERN.test(key)
    ) {
      delete env[key];
    }
  }
  return { ...withLfCheckout(env), ...overrides };
}

/**
 * Add `core.autocrlf=false` through GIT_CONFIG_COUNT/KEY_n/VALUE_n unless the
 * environment already sets core.autocrlf that way.
 *
 * NOTE: Git for Windows ships `core.autocrlf=true` in its system gitconfig,
 * and generated projects such as TempoRaid have no .gitattributes. Every
 * worktree working copy therefore had CRLF while the commits were LF, so the
 * project's `prettier --check` failed on files no one changed and tasks 1307
 * and 1403 stopped to ask for line-ending exceptions (2026-11-23). Environment
 * config reaches only the processes rapitas spawns; the user's git config and
 * the primary checkout are untouched. A project's .gitattributes still wins.
 *
 * @param env - Environment to extend / 追加対象の環境変数
 * @returns The environment with core.autocrlf=false added / core.autocrlf=false を加えた環境変数
 */
export function withLfCheckout(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const count = Number.parseInt(env.GIT_CONFIG_COUNT ?? '', 10);
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  for (let i = 0; i < n; i++) {
    if (env[`GIT_CONFIG_KEY_${i}`]?.toLowerCase() === 'core.autocrlf') return env;
  }
  return {
    ...env,
    GIT_CONFIG_COUNT: String(n + 1),
    [`GIT_CONFIG_KEY_${n}`]: 'core.autocrlf',
    [`GIT_CONFIG_VALUE_${n}`]: 'false',
  };
}
