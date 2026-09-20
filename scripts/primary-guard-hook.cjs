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
// Anything that can turn quoted text into executed code: nested shells, eval, command
// substitution, backticks, or interpreters fed by a pipe.
const EXEC_INDIRECTION =
  /\b(?:sh|bash|zsh|dash|cmd|pwsh|powershell|eval|iex|invoke-expression|xargs|source|exec|env|node|python\d?|start-process|invoke-command)\b/i;
const SUBSTITUTION = /\$\(|`/;
const QUOTED_SPAN = /"(?:\\.|[^"\\])*"|'[^']*'/g;

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
  let quotedCommandWord = false;
  const rest = code.replace(QUOTED_SPAN, (span, offset) => {
    // A quoted word at command position ('taskkill' /F, & "pkill") is still executed.
    if (/(?:^|[;&|(\n])\s*$/.test(code.slice(0, offset))) quotedCommandWord = true;
    return '""';
  });
  // Interpreter names only count outside quotes: "Bash" inside a JSON string is data.
  return quotedCommandWord || EXEC_INDIRECTION.test(rest) || PROC_KILL.test(rest);
}

/**
 * Classify a command. Returns the incident kind or null when allowed.
 *
 * @param command - Shell command text / シェルコマンド
 * @param ctx - `{ primaryRoot }` resolved primary checkout / 解決済み primary ルート
 * @returns 'primary_mutation' | 'prisma' | 'process_kill' | null
 */
function classify(command, ctx) {
  // Prose (quoted-delimiter heredoc bodies, commit messages) is not executed, so
  // words like "prisma generate" inside it must not trigger a denial.
  const code = stripProse(command);
  if (PRISMA.test(code)) return 'prisma';
  if (hasProcessKill(code)) return 'process_kill';
  if (!ctx.primaryRoot) return null; // cannot resolve primary → fail open for the path rule
  const primary = normalizePaths(ctx.primaryRoot).replace(/\/+$/, '');
  const norm = normalizePaths(code).split(`${primary}/.worktrees/`).join('WT/');
  const escaped = primary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Any command after entering the primary checkout is denied: relative-path
  // edits (`cd <primary> && sed -i ...`, `python fix.py`) cannot be enumerated.
  const entersPrimary = new RegExp(
    `\\b(?:cd|chdir|pushd|set-location|sl)\\s+["']?${escaped}(?![\\w.-])`,
  ).test(norm);
  if (entersPrimary) return 'primary_mutation';
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
    prisma:
      'Command rejected: prisma generate/db push/db:prepare must not be run by agents (dev.js does it on startup; running it rewrites shared generated files and can kill the backend).',
    process_kill:
      "Command rejected: never stop/kill processes (Stop-Process/taskkill/pkill). The backend on port 3001 is the agent's own connection.",
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
