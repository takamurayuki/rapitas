#!/usr/bin/env node
/**
 * alert-backlog-watch
 *
 * Turns code-scanning and Dependabot alerts that have stayed open past their
 * age limit into ONE GitHub issue, kept up to date, and closes that issue when
 * the backlog is clear. Not responsible for fixing alerts or for the PR-time
 * gates (see audit-gate.cjs and the CodeQL check).
 *
 * Exists because (#1390) 115 code-scanning and 24 Dependabot alerts
 * accumulated from 2026-02 on: the Security tab is a place nobody visits, the
 * PR checks pass on notes, warnings and dev-only findings, and nothing ever
 * said "this one has been open for eight months". Issues, by contrast, are
 * read, and #1366 makes sure they close.
 *
 * Usage (CI): GITHUB_REPOSITORY=owner/repo node scripts/security/alert-backlog-watch.cjs
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const LABEL = 'security-backlog';
const TITLE = 'Security alerts past their age limit';
const DAY = 24 * 60 * 60 * 1000;

/** Days an alert may stay open, by normalized severity. */
const LIMIT_DAYS = { critical: 7, high: 7, medium: 30, low: 60 };

/**
 * Collapse the two APIs' severity vocabularies onto critical/high/medium/low.
 *
 * Code scanning uses security_severity_level for security rules and
 * severity (error/warning/note) for quality rules; Dependabot uses
 * security_advisory.severity (critical/high/medium/low).
 *
 * @param {object} a - Raw alert / アラート
 * @param {'code-scanning'|'dependabot'} source - API it came from / 取得元
 * @returns {'critical'|'high'|'medium'|'low'} Normalized severity / 正規化した深刻度
 */
function severityOf(a, source) {
  const raw =
    source === 'dependabot'
      ? a.security_advisory && a.security_advisory.severity
      : (a.rule && (a.rule.security_severity_level || a.rule.severity)) || '';
  const s = String(raw).toLowerCase();
  if (s === 'critical') return 'critical';
  if (s === 'high' || s === 'error') return 'high';
  if (s === 'medium' || s === 'moderate' || s === 'warning') return 'medium';
  return 'low';
}

/**
 * Pick the alerts that are past their age limit.
 *
 * @param {{source:string, alert:object}[]} items - Open alerts with their source / 取得元つきアラート
 * @param {Date} now - Clock / 現在時刻
 * @returns {{source:string, number:number, severity:string, ageDays:number, what:string, where:string, url:string}[]} Overdue, oldest first / 期限超過(古い順)
 */
function overdue(items, now) {
  const out = [];
  for (const { source, alert: a } of items) {
    const severity = severityOf(a, source);
    const ageDays = Math.floor((now - new Date(a.created_at)) / DAY);
    if (ageDays <= LIMIT_DAYS[severity]) continue;
    const what =
      source === 'dependabot'
        ? `${a.dependency.package.name} (${a.security_advisory.ghsa_id})`
        : `${a.rule.id}`;
    const where =
      source === 'dependabot'
        ? a.dependency.manifest_path
        : `${a.most_recent_instance.location.path}:${a.most_recent_instance.location.start_line}`;
    out.push({ source, number: a.number, severity, ageDays, what, where, url: a.html_url });
  }
  return out.sort((x, y) => y.ageDays - x.ageDays);
}

/**
 * Render the tracking issue body.
 *
 * @param {ReturnType<typeof overdue>} list - Overdue alerts / 期限超過アラート
 * @param {Date} now - Clock / 現在時刻
 * @returns {string} Markdown body / 本文
 */
function renderBody(list, now) {
  const count = (source) => list.filter((x) => x.source === source).length;
  const lines = [
    `Updated ${now.toISOString().slice(0, 10)} by \`alert-backlog-watch\` (#1390). ` +
      'This issue closes itself when every alert below is fixed or dismissed with a reason.',
    '',
    `Age limits: critical/high ${LIMIT_DAYS.high} days, medium ${LIMIT_DAYS.medium} days, ` +
      `low ${LIMIT_DAYS.low} days.`,
    '',
    `**${list.length} past the limit** — code scanning ${count('code-scanning')}, ` +
      `Dependabot ${count('dependabot')}.`,
    '',
    '| source | # | severity | age (days) | what | where |',
    '|---|---|---|---|---|---|',
  ];
  const MAX_ROWS = 150;
  for (const x of list.slice(0, MAX_ROWS)) {
    lines.push(
      `| ${x.source} | [${x.number}](${x.url}) | ${x.severity} | ${x.ageDays} | ${x.what} | \`${x.where}\` |`,
    );
  }
  if (list.length > MAX_ROWS) lines.push('', `…and ${list.length - MAX_ROWS} more.`);
  return lines.join('\n');
}

/**
 * Open, update or close the single tracking issue.
 *
 * @param {{repo:string, list:ReturnType<typeof overdue>, now:Date, gh:(args:string[])=>string}} p - Inputs / 入力
 * @returns {'opened'|'updated'|'closed'|'clear'} What it did / 実施内容
 */
function reconcileIssue({ repo, list, now, gh }) {
  const open = JSON.parse(
    gh([
      'issue',
      'list',
      '--repo',
      repo,
      '--state',
      'open',
      '--label',
      LABEL,
      '--json',
      'number,title',
    ]),
  ).filter((i) => i.title === TITLE);
  const existing = open[0];
  if (!list.length) {
    if (!existing) return 'clear';
    gh([
      'issue',
      'close',
      String(existing.number),
      '--repo',
      repo,
      '--reason',
      'completed',
      '--comment',
      'No code-scanning or Dependabot alert is past its age limit any more.',
    ]);
    return 'closed';
  }
  const body = renderBody(list, now);
  if (existing) {
    gh(['issue', 'edit', String(existing.number), '--repo', repo, '--body', body]);
    return 'updated';
  }
  gh(['issue', 'create', '--repo', repo, '--title', TITLE, '--label', LABEL, '--body', body]);
  return 'opened';
}

function realGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function fetchAlerts(repo, kind, gh) {
  const raw = gh(['api', '--paginate', `repos/${repo}/${kind}/alerts?state=open&per_page=100`]);
  // --paginate concatenates one JSON array per page.
  return JSON.parse(
    `[${raw
      .trim()
      .replace(/\]\s*\[/g, ',')
      .slice(1, -1)}]`,
  );
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is required');
  // A failed fetch must turn the run red: an unreadable alert list that is
  // treated as "no alerts" would close the tracking issue on a blind run.
  const items = [
    ...fetchAlerts(repo, 'code-scanning', realGh).map((alert) => ({
      source: 'code-scanning',
      alert,
    })),
    ...fetchAlerts(repo, 'dependabot', realGh).map((alert) => ({ source: 'dependabot', alert })),
  ];
  const now = new Date();
  const list = overdue(items, now);
  const did = reconcileIssue({ repo, list, now, gh: realGh });
  const summary = `alert-backlog-watch: ${items.length} open, ${list.length} past the limit → issue ${did}`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n\n${renderBody(list, now)}\n`);
  }
}

if (require.main === module) main();

module.exports = { severityOf, overdue, renderBody, reconcileIssue, LIMIT_DAYS, TITLE, LABEL };
