/**
 * log-patterns/hidden-patterns
 *
 * Noise-line patterns whose matches are dropped from the friendly log view
 * entirely (blank lines, diff hunks, code fragments, shell path echoes).
 * Split out of log-patterns-table.ts per COMPONENT_SPLITTING_POLICY.
 */

export const HIDDEN_PATTERNS = [
  /^\s*$/,
  /^[{}\[\],:]*$/,
  /^Active code page:/i,
  /^現在のコード ページ:/i,
  /^chcp\s/i,
  // The dispatched-prompt banner ([Claude Code] Prompt: …) is a mechanical
  // echo of the instruction, not something the user acts on; shown, its
  // system-prompt text read as agent speech (operator decision 2026-09-06).
  /^\[(?:Codex|Gemini|Claude(?: Code)?)\]\s*Prompt:/i,
  /^\[codex\] hidden \d+ noisy line\(s\)/i,
  /^\[gemini\] hidden \d+ noisy line\(s\)/i,
  /codex_core::session: failed to record rollout/i,
  /^diff --git /,
  /^index [a-f0-9]+\.\.[a-f0-9]+/,
  /^--- /,
  /^\+\+\+ /,
  /^@@ /,
  /^[+-](?![+-]{2}\s)/,
  /^\$?\s*(?:[A-Za-z]:[\\/])?[\w@()[\].-]+(?:[\\/][\w@()[\].-]+)+$/,
  /^(import|export|const|let|function|class|interface|type|return|if|else|try|catch)\b/,
  /^[A-Za-z0-9_$]+\.(error|warn|info|debug|log)\(/,
  /^<\/?[A-Za-z][^>]*>/,
];
