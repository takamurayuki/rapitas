/**
 * plan-deviation/operation-extractor
 *
 * Turns one Claude `tool_use` (name + raw input) into judging features:
 * file_change for modifying tools, command names (+ URL hosts) for Bash, and
 * hosts for WebFetch. Read-only tools are not recorded (Q1: only additions /
 * modifications are judged). Pure functions only — masking happens in the store.
 */
import type { OperationFeatures, OperationKind } from './types';

/** Tools that add or modify files, with the input key holding the path. */
const FILE_TOOLS: Record<string, string> = {
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};

/** Shell separators that start a new command: `&&`, `||`, `;`, `|`, `&`, newline. */
const SEPARATOR_CHARS = new Set([';', '|', '&', '\n']);

/**
 * Split a script on command separators that are outside quotes: the `|` in
 * `grep -E "tests|fail"` is part of an argument, and splitting there read
 * `fail` as a command (audit 2026-11-17).
 */
function splitOutsideQuotes(script: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let current = '';
  for (const ch of script) {
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
    } else if (SEPARATOR_CHARS.has(ch)) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/** Redirections such as `2>&1`, `>&2`, `&>out`, `>out.log` — not commands. */
const REDIRECT_RE = /\d*>>?&\d+|&>>?\S*|\d*[<>]>?\s*[^\s;|&]+/g;

/** `<<EOF` / `<<'EOF'` / `<<-"EOF"` heredoc opener; group 2 is the terminator. */
const HEREDOC_RE = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/;

/** Shell keywords that introduce the command after them, not a command of their own. */
const SHELL_KEYWORDS: ReadonlySet<string> = new Set([
  'do',
  'done',
  'while',
  'until',
  'if',
  'then',
  'elif',
  'else',
  'fi',
  'case',
  'esac',
  'time',
  '!',
]);

/**
 * Whether a recorded name can be a command at all. Older recordings stored
 * the pieces of redirects, heredoc bodies and options as names (`1`, `eof`,
 * `const`, `--data-binary`); the classifier drops those too.
 *
 * @param name - Lower-case command name / コマンド名
 * @returns True when it looks like a command / コマンド名として妥当なら true
 */
export function isPlausibleCommandName(name: string): boolean {
  return /^[a-z_.[][a-z0-9_.+\-[]*$/.test(name) && !/^\d+$/.test(name) && !NOT_COMMANDS.has(name);
}

/** Heredoc terminators and source keywords that old recordings stored as names. */
const NOT_COMMANDS: ReadonlySet<string> = new Set([
  'eof',
  'const',
  'let',
  'var',
  'import',
  'export',
  'return',
  'function',
  'interface',
  'async',
  'await',
]);

/** Remove heredoc bodies and redirections, and join backslash-newline continuations. */
function normalizeScript(command: string): string {
  const lines = command.replace(/\\\r?\n/g, ' ').split(/\r?\n/);
  const kept: string[] = [];
  let terminator: string | null = null;
  for (const line of lines) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    const heredoc = HEREDOC_RE.exec(line);
    if (heredoc) terminator = heredoc[2];
    kept.push(line.replace(HEREDOC_RE, ''));
  }
  return kept.join('\n').replace(REDIRECT_RE, ' ');
}

/** Leading `NAME=value` env assignment before the command word. */
const ENV_PREFIX_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** URL authority: scheme://[userinfo@]host[:port]. */
const URL_RE = /\bhttps?:\/\/([^\s/'"`?#<>]+)/gi;

/** Max characters of a command kept for display. */
const SUMMARY_MAX = 300;

/** One operation extracted from a tool call (not yet sequenced or masked). */
export interface ExtractedOperation {
  kind: OperationKind;
  tool: string;
  features: OperationFeatures;
  /** Raw human-readable summary — MUST be masked before display or storage. */
  summary: string;
}

/**
 * Split a shell command line into the command names it runs. Arguments are
 * dropped (Q2: names only); leading env assignments, quotes, directories and
 * `.exe` are stripped.
 *
 * @param command - Raw shell command line / シェルコマンド文字列
 * @returns Unique lower-case command names in order / コマンド名一覧
 */
export function splitCommandNames(command: string): string[] {
  const names: string[] = [];
  for (const segment of splitOutsideQuotes(normalizeScript(command))) {
    const tokens = segment
      .trim()
      .replace(/^[({]+\s*/, '')
      .split(/\s+/)
      .filter(Boolean);
    // `for x in a b` only names a loop variable and its words; nothing runs.
    if (tokens[0]?.toLowerCase() === 'for') continue;
    let i = 0;
    while (
      i < tokens.length &&
      (ENV_PREFIX_RE.test(tokens[i]) || SHELL_KEYWORDS.has(tokens[i].toLowerCase()))
    ) {
      i++;
    }
    const word = tokens[i];
    if (!word) continue;
    const name = word
      .replace(/^["']|["')}]+$/g, '')
      .replace(/^.*[/\\]/, '')
      .replace(/\.exe$/i, '')
      .toLowerCase();
    if (name && isPlausibleCommandName(name) && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Extract HTTP(S) hosts referenced in a string.
 *
 * @param text - Command line or URL / コマンド文字列またはURL
 * @returns Unique lower-case hosts (userinfo and port removed) / ホスト一覧
 */
export function extractUrlHosts(text: string): string[] {
  const hosts: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const authority = m[1].replace(/^.*@/, '');
    const host = (
      authority.startsWith('[') ? authority.replace(/\].*$/, ']') : authority.replace(/:\d*$/, '')
    )
      .toLowerCase()
      .replace(/^\[|\]$/g, '');
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

/** Read a string field from an unknown tool input. */
function readString(input: unknown, key: string): string | null {
  if (!input || typeof input !== 'object') return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Extract the operations a single tool call performs.
 *
 * @param toolName - tool_use name (e.g. `Bash`) / ツール名
 * @param input - Raw tool_use input / 生のツール入力
 * @returns Zero or more operations (Bash with URLs yields command + http) / 抽出した操作
 */
export function extractOperations(toolName: string, input: unknown): ExtractedOperation[] {
  const fileKey = FILE_TOOLS[toolName];
  if (fileKey) {
    const path = readString(input, fileKey);
    return path ? [{ kind: 'file_change', tool: toolName, features: { path }, summary: path }] : [];
  }
  if (toolName === 'Bash') {
    const command = readString(input, 'command');
    if (!command) return [];
    const summary = command.length > SUMMARY_MAX ? `${command.slice(0, SUMMARY_MAX)}…` : command;
    const ops: ExtractedOperation[] = [];
    const commandNames = splitCommandNames(command);
    if (commandNames.length > 0) {
      ops.push({ kind: 'command', tool: toolName, features: { commandNames }, summary });
    }
    const hosts = extractUrlHosts(command);
    if (hosts.length > 0) ops.push({ kind: 'http', tool: toolName, features: { hosts }, summary });
    return ops;
  }
  if (toolName === 'WebFetch') {
    const url = readString(input, 'url');
    const hosts = url ? extractUrlHosts(url) : [];
    return url && hosts.length > 0
      ? [{ kind: 'http', tool: toolName, features: { hosts }, summary: url }]
      : [];
  }
  return [];
}
