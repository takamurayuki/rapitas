/**
 * Tool Name Canonicalizer
 *
 * Maps provider-specific tool names emitted by Codex / Gemini CLI streams
 * onto the canonical Claude Code tool names that the frontend log-pattern
 * table recognises. Without this normalisation, the same operation
 * (e.g. reading a file) renders with three different prefixes —
 * `[Tool: Read]` for Claude, `[Tool: ReadFile]` for Codex/Gemini, etc. —
 * and the unified UI rendering rules only match Claude's.
 *
 * Adding a new alias here is preferable to teaching the frontend table
 * about every provider's vocabulary.
 */

const ALIASES: Record<string, string> = {
  // File reads
  ReadFile: 'Read',
  read_file: 'Read',
  // File writes
  WriteFile: 'Write',
  write_file: 'Write',
  // File edits
  edit_file: 'Edit',
  apply_patch: 'Edit',
  // Search
  FindFiles: 'Glob',
  glob: 'Glob',
  SearchText: 'Grep',
  grep: 'Grep',
  // Shell / Bash
  Shell: 'Bash',
  bash: 'Bash',
  local_shell: 'Bash',
  RunCommand: 'Bash',
  run_command: 'Bash',
  // Web
  GoogleSearch: 'WebSearch',
  google_search: 'WebSearch',
  web_search: 'WebSearch',
  fetch_url: 'WebFetch',
  // Sub-agents
  CodebaseInvestigatorAgent: 'Agent',
  // Memory / TODO
  SaveMemory: 'TodoWrite',
  WriteTodos: 'TodoWrite',
};

/**
 * Return the canonical (Claude Code) tool name for any provider's variant.
 * Names already canonical are returned unchanged. Unknown names pass through.
 *
 * @param raw - Tool name as emitted by the provider's stream JSON
 */
export function canonicalToolName(raw: string | undefined | null): string {
  if (!raw) return 'unknown';
  return ALIASES[raw] ?? raw;
}
