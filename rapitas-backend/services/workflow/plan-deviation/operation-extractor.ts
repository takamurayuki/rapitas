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
const SEPARATOR_RE = /&&|\|\||[;|&\n]/;

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
  for (const segment of command.split(SEPARATOR_RE)) {
    const tokens = segment.trim().replace(/^[({]+\s*/, '').split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < tokens.length && ENV_PREFIX_RE.test(tokens[i])) i++;
    const word = tokens[i];
    if (!word) continue;
    const name = word
      .replace(/^["']|["')}]+$/g, '')
      .replace(/^.*[/\\]/, '')
      .replace(/\.exe$/i, '')
      .toLowerCase();
    if (name && !names.includes(name)) names.push(name);
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
    const host = (authority.startsWith('[') ? authority.replace(/\].*$/, ']') : authority.replace(/:\d*$/, ''))
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
