/**
 * ClaudeCliTools
 *
 * What an auxiliary CLI call is allowed to reach outside itself.
 *
 * Kept in one small file on purpose. This is the whole security surface of
 * the aux provider: every text-generation call in the app runs with the
 * repo, the shell and the network switched off, and exactly one job —
 * looking candidates up — is allowed past that. Spreading the decision
 * through the provider is how it would quietly stop being true.
 */

/**
 * What a call may use.
 *
 * `none` is the default and what every caller but research gets. `web`
 * opens search and page fetching and nothing else. It is a per-call
 * argument rather than a setting, so no amount of prompt text can talk a
 * text-generation call into reaching the network.
 */
export type CliToolAccess = 'none' | 'web';

/** Tools disabled for pure text generation — no repo/file/shell/network access. */
const DISALLOWED_TOOLS =
  'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task,NotebookEdit,TodoWrite,MultiEdit';

/** The two tools a research call may use, and no others. */
const WEB_TOOLS = 'WebSearch,WebFetch';

/** Auxiliary calls generate text; they do not need the coding-agent prompt or tools. */
const TEXT_ONLY_ARGS = [
  '--effort',
  'low',
  '--tools',
  '',
  '--system-prompt',
  'You are a text processing assistant. Follow the supplied instructions and return only the requested text. Do not use tools.',
];

/**
 * The CLI arguments that grant exactly this much access.
 *
 * The web case is an allow-list rather than a shorter deny-list: a tool
 * added to the CLI in some later version must not become reachable here
 * just because nobody remembered to deny it.
 *
 * @param access - What this call may reach / この呼び出しが使える道具
 * @returns The arguments to pass / 渡す引数
 */
export function toolArgsFor(access: CliToolAccess): string[] {
  return access === 'web'
    ? ['--allowedTools', WEB_TOOLS]
    : ['--disallowedTools', DISALLOWED_TOOLS, ...TEXT_ONLY_ARGS];
}
