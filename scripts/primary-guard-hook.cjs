#!/usr/bin/env node
'use strict';

// PreToolUse guard: keeps a worktree-bound agent's Bash/PowerShell from touching
// the primary checkout, Prisma generation, or backend processes. A quality
// guard against the observed incident (ci_repair ran `cd <primary> && git pull
// && bun run db:prepare:sqlite`), not a shell sandbox — `sh -c`/variable
// expansion can still evade it; worktree isolation stays the real boundary.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_COMMAND_CHARS = 200;

/** Lowercase, forward-slash form with `/c/x` rewritten to `c:/x`. */
function normalizePaths(text) {
  return String(text)
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/(^|[\s"'=(;&|])\/([a-z])\//g, '$1$2:/');
}

/** Primary checkout root: explicit env first, else the parent of `.worktrees/`. */
function resolvePrimaryRoot(env, projectDir) {
  if (env.RAPITAS_PRIMARY_ROOT) return env.RAPITAS_PRIMARY_ROOT;
  const norm = normalizePaths(projectDir || '');
  const idx = norm.indexOf('/.worktrees/');
  return idx > 0 ? String(projectDir).replace(/\\/g, '/').slice(0, idx) : null;
}

const MUTATION =
  /\bgit\s+(?:-c\s+\S+\s+)?(?:pull|push|fetch|checkout|switch|reset|merge|rebase|commit|add|stash|clean|restore|cherry-pick|apply|am|branch|tag|worktree)\b|\b(?:bun|bunx|npm|npx|pnpm|yarn)\b|\bprisma\b|\b(?:rm|mv|cp|mkdir|rmdir|del|touch|sed|remove-item|move-item|copy-item|new-item|set-content|add-content|out-file|clear-content)\b|(?:^|[^-\w])>{1,2}(?!&)/i;
const PRISMA = /\bprisma\s+(?:generate|db\s+push|migrate)\b|\bdb:(?:prepare|generate|push)\b/i;
const PROC_KILL = /\b(?:stop-process|taskkill|pkill|killall)\b/i;
// Package installers rewrite the node_modules tree that every worktree shares
// with the primary checkout through junctions (2026-09-24, task 1055: a pnpm
// install inside a worktree re-pointed 60 primary symlinks at the worktree
// path; 2026-09-02: a worktree pnpm exec purged the primary tree). Agents
// never install — dependency changes are the operator's job in primary.
// `run`/`exec`/`test`/`x`/`dlx`/`create` subcommands are script runners, never
// installers, so they are excluded before scanning the (up to three) leading
// options/args (`pnpm -C rapitas-frontend install`, `npm --prefix x ci`).
// `bun pm cache` only touches bun's global download cache, never the shared
// node_modules tree, so it is excluded too (task 1086: `bun pm cache rm` was
// misclassified as package_install because bare `rm` matches the verb list).
const PACKAGE_INSTALL =
  /\b(?:npm|pnpm|yarn|bun)\s+(?!(?:run|exec|test|x|dlx|create)\b)(?!pm\s+cache\b)(?:\S+\s+){0,3}?(?:install|i|ci|add|remove|rm|uninstall|un|update|up|upgrade|dedupe|prune|link|unlink|rebuild|import)\b(?!\s*:)/i;
// Anything that can turn quoted text into executed code: nested shells, eval, command
// substitution, backticks, or interpreters fed by a pipe.
const EXEC_INDIRECTION =
  /\b(?:sh|bash|zsh|dash|cmd|pwsh|powershell|eval|iex|invoke-expression|xargs|source|exec|env|node|python\d?|start-process|invoke-command)\b/i;
const SUBSTITUTION = /\$\(|`/;
const QUOTED_SPAN = /"(?:\\.|[^"\\])*"|'[^']*'/g;
const REDIRECT = /(?:^|[^-\w])>{1,2}(?!&)/;
// One pipeline segment that only inspects: navigation, read-only git verbs
// (`git branch` only in its listing forms — `git branch foo` creates), and
// listing/reading tools. `find` is excluded once it can act (-exec/-delete/-ok/-fprint*).
const READ_ONLY_SEGMENT =
  /^(?:(?:cd|chdir|pushd|set-location|sl)\s+\S+|git\s+(?:(?:status|log|diff|show|rev-parse|ls-files|describe|blame|remote|worktree\s+list)\b(?![^\n]*--output)|branch(?:\s+(?:--list|--show-current|-[avr]+|--contains\s+\S+))*\s*$)|(?:ls|dir|cat|head|tail|wc|grep|rg|type|test|gci|gc|sls|get-childitem|get-content|select-string)(?:\s|$)|find(?![^\n]*\s-(?:exec|execdir|ok|okdir|delete|fprint\w*)\b)(?:\s|$))/;

/**
 * True when every pipeline segment only inspects (no writes, redirects,
 * substitution, or interpreters). Deliberately conservative: anything not on
 * the allow-list is treated as a potential mutation.
 *
 * @param code - Normalized command text / 正規化済みコマンド
 * @returns Whether the command is read-only inspection / 読み取り専用か
 */
function isReadOnlyInspection(code) {
  if (SUBSTITUTION.test(code) || EXEC_INDIRECTION.test(code) || REDIRECT.test(code)) return false;
  const segments = code
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim().replace(/^(?:\w+=\S*\s+)+/, ''))
    .filter(Boolean);
  return segments.length > 0 && segments.every((s) => READ_ONLY_SEGMENT.test(s));
}

/**
 * True when the command really names a process-killing tool. Words that appear only inside
 * quoted arguments (`grep -n "taskkill" f`, printf data) are data, not commands.
 * Fails closed: indirection, a quoted command word, or an unterminated quote keeps the denial.
 *
 * @param code - Command text with prose stripped / prose 除去済みコマンド
 * @returns Whether a kill tool is (potentially) executed / kill が実行されうるか
 */
function hasProcessKill(code) {
  if (!PROC_KILL.test(code)) return false;
  if (SUBSTITUTION.test(code)) return true;
  // rg --pre/--hostname-bin execute their (usually quoted) argument, so a kill word inside it is code.
  // Only the option's own argument is executed; `rg --pre cat 'pkill' .` searches for the word.
  for (const m of code.matchAll(EXEC_OPTION_ARG_RE)) if (PROC_KILL.test(m[1])) return true;
  let quotedCommandWord = false;
  const rest = code.replace(QUOTED_SPAN, (span, offset) => {
    // A quoted word at command position ('taskkill' /F, & "pkill") is still executed.
    if (/(?:^|[;&|(\n])\s*$/.test(code.slice(0, offset))) quotedCommandWord = true;
    return '""';
  });
  // Interpreter names only count outside quotes: "Bash" inside a JSON string is data.
  // The exec option's own argument was already checked above; the flag's mere
  // presence must not turn a quoted search word (`rg --pre cat 'pkill' .`) into
  // a denial — that is exactly the scoping the test at :280 pins down.
  return quotedCommandWord || EXEC_INDIRECTION.test(rest) || PROC_KILL.test(rest);
}

/**
 * Classify a command. Returns the incident kind or null when allowed.
 *
 * @param command - Shell command text / シェルコマンド
 * @param ctx - `{ primaryRoot }` resolved primary checkout / 解決済み primary ルート
 * @returns 'primary_mutation' | 'primary_readonly' | 'prisma' | 'process_kill' | 'package_install' | null
 */
function classify(command, ctx) {
  // Prose (quoted-delimiter heredoc bodies, commit messages) is not executed, so
  // words like "prisma generate" inside it must not trigger a denial.
  const code = stripProse(command);
  if (PRISMA.test(code)) return 'prisma';
  if (hasProcessKill(code)) return 'process_kill';
  // Quoted occurrences (`grep "pnpm install"`, commit text) are data, not commands.
  if (PACKAGE_INSTALL.test(code.replace(QUOTED_SPAN, '""'))) return 'package_install';
  if (!ctx.primaryRoot) return null; // cannot resolve primary → fail open for the path rule
  const primary = normalizePaths(ctx.primaryRoot).replace(/\/+$/, '');
  const norm = normalizePaths(code).split(`${primary}/.worktrees/`).join('WT/');
  const escaped = primary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Any command after entering the primary checkout is denied: relative-path
  // edits (`cd <primary> && sed -i ...`, `python fix.py`) cannot be enumerated.
  const entersPrimary = new RegExp(
    `\\b(?:cd|chdir|pushd|set-location|sl)\\s+["']?${escaped}(?![\\w.-])`,
  ).test(norm);
  // Still denied (nothing after the cd can be enumerated), but a read-only
  // inspection is not an attempted mutation: filed as one it produced
  // high-severity security tasks for `cd <primary> && git status` (1079/1080,
  // 2026-09-25). The distinct kind lets the incident filer skip it.
  if (entersPrimary) return isReadOnlyInspection(norm) ? 'primary_readonly' : 'primary_mutation';
  const mentionsPrimary = new RegExp(`${escaped}(?![\\w.-])`).test(norm);
  if (mentionsPrimary && MUTATION.test(norm)) return 'primary_mutation';
  // Shell already sitting in the primary checkout: any mutating command is denied.
  const cwd = ctx.cwd ? normalizePaths(ctx.cwd) : '';
  const cwdInPrimary =
    cwd &&
    (cwd === primary || cwd.startsWith(`${primary}/`)) &&
    !cwd.startsWith(`${primary}/.worktrees/`);
  return cwdInPrimary && MUTATION.test(norm) ? 'primary_mutation' : null;
}

// `<<<` (here-string) and `1<<2` (shift) are excluded by the lookarounds; anything that still
// mis-parses as a heredoc is caught by the unterminated-body fallback in stripProse.
const HEREDOC_RE = /(?<!<)<<(?!<)-?\s*(?:'([^']+)'|"([^"$`]+)"|\\(\w+)|(\w+))/g;

/**
 * Keep only the parts of an expanding (unquoted-delimiter) heredoc body that the shell executes.
 *
 * @param body - Heredoc body text / heredoc 本文
 * @returns `$(...)` (nested, multi-line) and backtick spans joined by newlines / 実行されるスパン
 */
function extractExpansions(body) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') {
      i++; // an escaped `$` or backtick is literal text
    } else if (body[i] === '$' && body[i + 1] === '(') {
      let depth = 0;
      let j = i + 1;
      for (; j < body.length; j++) {
        if (body[j] === '(') depth++;
        else if (body[j] === ')' && --depth === 0) break;
      }
      out.push(body.slice(i, j + 1));
      i = j;
    } else if (body[i] === '`') {
      const j = body.indexOf('`', i + 1);
      const last = j < 0 ? body.length - 1 : j;
      out.push(body.slice(i, last + 1));
      i = last;
    }
  }
  return out.join('\n');
}

const EXEC_OPTION_RE = /\s--(?:pre|hostname-bin)(?![\w-])/i;
// Captures the argument of --pre/--hostname-bin: quoted (may hold a whole command line) or a bare word.
const EXEC_OPTION_ARG_RE = /\s--(?:pre|hostname-bin)(?![\w-])(?:=|\s+)?("(?:\\.|[^"\\])*"|'[^']*'|\S+)/gi;
const SEARCH_VERB_RE = /^(?:grep|egrep|fgrep|rg|select-string|findstr)(?=\s)/i;

/**
 * Blank the literal quoted arguments of read-only search commands (`grep "taskkill" f`).
 *
 * The search term is data, not something executed. Scope is limited to one pipeline
 * segment: a separator ends it, so `grep x; pkill bun` still exposes the kill. Double
 * quotes containing `$(`/backtick (or unterminated) are kept because the shell executes them.
 *
 * @param line - One command line / コマンド1行
 * @returns Line with safe quoted search arguments replaced by empty quotes / 安全な引用を空にした行
 */
function blankSearchArgs(line) {
  let out = '';
  let inSearch = false;
  let atCommandStart = true;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (atCommandStart && !/\s/.test(ch)) {
      atCommandStart = false;
      // rg --pre/--hostname-bin run their argument as a command, so it is code, not a search term.
      if (SEARCH_VERB_RE.test(line.slice(i)) && !EXEC_OPTION_RE.test(line.slice(i))) inSearch = true;
    }
    if (/[;&|(`]/.test(ch)) {
      inSearch = false;
      atCommandStart = true;
    }
    if (inSearch && (ch === '"' || ch === "'")) {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) j += ch === '"' && line[j] === '\\' ? 2 : 1;
      const body = line.slice(i + 1, j);
      const closed = j < line.length;
      const executes = ch === '"' && (body.includes('$(') || body.includes('`'));
      if (closed && !executes) {
        out += ch + ch;
        i = j;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/** Drop literal heredoc bodies and `git commit -m "..."` messages before pattern matching. */
function stripProse(command) {
  const lines = command.split(/\r?\n/);
  const kept = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i++];
    kept.push(line);
    // Quoted (`'EOF'`, `"EOF"`) and backslash-escaped (`\EOF`) delimiters disable expansion;
    // a bare delimiter does not. One line may open several heredocs (`cat <<A <<B`).
    for (const m of line.matchAll(HEREDOC_RE)) {
      const end = m[1] ?? m[2] ?? m[3] ?? m[4];
      let j = i;
      // trim() ends the body no later than the shell would, so code is never skipped.
      while (j < lines.length && lines[j].trim() !== end) j++;
      // Unterminated: not really a heredoc — keep the rest as code (fail closed).
      if (j >= lines.length) break;
      if (m[4] !== undefined) {
        const spans = extractExpansions(lines.slice(i, j).join('\n'));
        if (spans) kept.push(spans);
      }
      i = j + 1;
    }
  }
  return kept
    .map(blankSearchArgs)
    .join('\n')
    .replace(
      /(\bgit\s+commit\b[^\n]*?\s(?:-m|--message)\s+)(?:"(?:\\.|[^"\\])*"|'[^']*')/gi,
      '$1""',
    );
}

/**
 * Append a redacted incident line to the guard NDJSON log.
 *
 * @param incident - `{ kind, command, projectDir }` / 検知内容
 * @param dir - Log directory override / ログディレクトリ
 */
function recordIncident(incident, dir) {
  const logDir =
    dir ||
    process.env.RAPITAS_GUARD_LOG_DIR ||
    path.join(process.env.RAPITAS_DATA_DIR || path.join(os.homedir(), '.rapitas'), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const taskMatch = /task-(\d+)-/.exec(String(incident.projectDir || '').replace(/\\/g, '/'));
  const redacted = String(incident.command)
    .replace(/((?:token|key|secret|password|database_url)\w*\s*=\s*)\S+/gi, '$1***')
    .slice(0, MAX_COMMAND_CHARS);
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  fs.appendFileSync(
    path.join(logDir, `guard-incidents-${stamp}.ndjson`),
    JSON.stringify({
      ts: now.toISOString(),
      taskId: taskMatch ? Number(taskMatch[1]) : null,
      kind: incident.kind,
      command: redacted,
    }) + '\n',
  );
}

/**
 * Pure decision: a deny payload for forbidden commands, otherwise undefined.
 *
 * @param input - Hook stdin payload / フック入力
 * @param ctx - Optional `{ primaryRoot, projectDir }` override / 上書き用コンテキスト
 */
function decision(input, ctx) {
  if (!['Bash', 'PowerShell'].includes(input.tool_name)) return undefined;
  const command = input.tool_input?.command;
  if (typeof command !== 'string') return undefined;
  const projectDir = ctx?.projectDir ?? process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? '';
  const primaryRoot =
    ctx && 'primaryRoot' in ctx ? ctx.primaryRoot : resolvePrimaryRoot(process.env, projectDir);
  const kind = classify(command, { primaryRoot, cwd: ctx?.cwd ?? input.cwd });
  if (!kind) return undefined;
  const reasons = {
    primary_mutation:
      'Command rejected: it modifies the primary checkout. Work only inside your task worktree; run tests/git there and never cd to the primary repository.',
    primary_readonly:
      'Command rejected: never cd into the primary checkout, even to inspect it. Read-only git inspection is allowed without entering it (e.g. `git -C <primary-checkout-path> status`); everything else belongs in your task worktree.',
    prisma:
      'Command rejected: prisma generate/db push/db:prepare must not be run by agents (dev.js does it on startup; running it rewrites shared generated files and can kill the backend).',
    process_kill:
      "Command rejected: never stop/kill processes (Stop-Process/taskkill/pkill). The backend on port 3001 is the agent's own connection.",
    package_install:
      'Command rejected: never run npm/pnpm/yarn/bun install/add/update in a worktree. node_modules is shared with the primary checkout through junctions and an install rewrites it for every worktree. If a dependency change is required, record it in verify.md as an unresolved concern for the operator.',
  };
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reasons[kind],
    },
    _kind: kind,
  };
}

if (require.main === module) {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    text += chunk;
  });
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(text);
      const result = decision(input);
      if (result) {
        const { _kind, ...payload } = result;
        try {
          recordIncident({
            kind: _kind,
            command: input.tool_input.command,
            projectDir: process.env.CLAUDE_PROJECT_DIR || input.cwd,
          });
        } catch {
          // Logging failure must not turn a deny into an allow.
        }
        process.stdout.write(JSON.stringify(payload));
      }
    } catch {
      // Fail open: a broken guard must not halt every agent.
    }
  });
}

module.exports = { decision, classify, recordIncident, resolvePrimaryRoot };
