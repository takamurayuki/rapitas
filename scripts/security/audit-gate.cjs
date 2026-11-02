#!/usr/bin/env node
/**
 * audit-gate
 *
 * Fails CI on any dependency advisory of severity high or above that is not
 * covered by an unexpired, written-down exception in
 * .github/audit-exceptions.json — and on any exception that has expired.
 * Not responsible for running the audits; the workflow hands it their JSON.
 *
 * Exists because (#1340) the previous gate failed only on PRODUCTION
 * CRITICALS, so every finding Dependabot raised (24 open on 2026-11-03, all
 * dev or high) passed it, and nothing made anyone look at them. An exception
 * is the explicit "we looked, here is why it can wait" — and its expiry makes
 * the question come back instead of letting the answer rot.
 *
 * Usage:
 *   node scripts/security/audit-gate.cjs \
 *     frontend=fe.json:pnpm desktop=desk.json:pnpm backend=be.json:bun
 */
const fs = require('node:fs');
const path = require('node:path');

const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const GATE = RANK.high;
const EXCEPTIONS_PATH = path.join(__dirname, '..', '..', '.github', 'audit-exceptions.json');

/**
 * Normalize one audit report into a flat finding list.
 *
 * @param {string} scope - Package label, e.g. "frontend" / パッケージ名
 * @param {'pnpm'|'bun'} format - Which tool wrote the JSON / 出力元ツール
 * @param {unknown} json - Parsed audit JSON / 監査JSON
 * @returns {{scope:string, pkg:string, ghsa:string, severity:string, title:string}[]} Findings / 検出一覧
 */
function parseAudit(scope, format, json) {
  const out = [];
  if (format === 'pnpm') {
    for (const a of Object.values((json && json.advisories) || {})) {
      out.push({
        scope,
        pkg: a.module_name,
        ghsa: a.github_advisory_id || ghsaFromUrl(a.url),
        severity: a.severity,
        title: a.title,
      });
    }
  } else if (format === 'bun') {
    for (const [pkg, list] of Object.entries(json || {})) {
      for (const a of list) {
        out.push({ scope, pkg, ghsa: ghsaFromUrl(a.url), severity: a.severity, title: a.title });
      }
    }
  } else {
    throw new Error(`unknown audit format "${format}"`);
  }
  return out;
}

function ghsaFromUrl(url) {
  const m = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(url || '');
  return m ? m[0] : String(url || 'unknown');
}

/**
 * Decide the gate: which high+ findings are uncovered, and which exceptions
 * have expired.
 *
 * @param {ReturnType<typeof parseAudit>} findings - All findings / 全検出
 * @param {{scope:string, ghsa:string, package:string, reason:string, expires:string}[]} exceptions - Written-down exceptions / 例外一覧
 * @param {Date} now - Clock / 現在時刻
 * @returns {{blocking: object[], excused: object[], expired: object[], invalid: object[]}} Verdict / 判定
 */
function evaluate(findings, exceptions, now) {
  const invalid = exceptions.filter(
    (e) => !e.scope || !e.ghsa || !e.reason || !/^\d{4}-\d{2}-\d{2}$/.test(e.expires || ''),
  );
  const expired = exceptions.filter(
    (e) => !invalid.includes(e) && new Date(`${e.expires}T23:59:59Z`) < now,
  );
  const live = exceptions.filter((e) => !invalid.includes(e) && !expired.includes(e));
  const blocking = [];
  const excused = [];
  for (const f of findings) {
    if ((RANK[f.severity] ?? RANK.critical) < GATE) continue;
    const ex = live.find(
      (e) => e.scope === f.scope && e.ghsa.toUpperCase() === f.ghsa.toUpperCase(),
    );
    (ex ? excused : blocking).push(ex ? { ...f, reason: ex.reason, expires: ex.expires } : f);
  }
  return { blocking, excused, expired, invalid };
}

/**
 * Render the verdict as Markdown for the Step Summary.
 *
 * @param {ReturnType<typeof evaluate>} v - Verdict / 判定
 * @returns {string} Markdown / Markdown
 */
function renderSummary(v) {
  const row = (f) => `| ${f.scope} | ${f.pkg} | ${f.severity} | ${f.ghsa} | ${f.title || ''} |`;
  const lines = ['## 依存監査ゲート (high 以上)', ''];
  lines.push(
    v.blocking.length || v.expired.length || v.invalid.length ? '**❌ 要対応**' : '**✅ 通過**',
    '',
  );
  if (v.blocking.length) {
    lines.push('### 例外の無い high 以上', '', '| scope | package | severity | advisory | title |');
    lines.push('|---|---|---|---|---|', ...v.blocking.map(row), '');
  }
  if (v.expired.length) {
    lines.push('### 期限切れの例外 (再評価して延長か修正を)', '');
    for (const e of v.expired)
      lines.push(`- ${e.scope} ${e.ghsa} (${e.package}) — 期限 ${e.expires}`);
    lines.push('');
  }
  if (v.invalid.length) {
    lines.push('### 不正な例外 (scope/ghsa/reason/expires が必須)', '');
    for (const e of v.invalid) lines.push(`- ${JSON.stringify(e)}`);
    lines.push('');
  }
  if (v.excused.length) {
    lines.push('### 例外で許容中 (期限つき)', '', '| scope | package | advisory | 期限 | 理由 |');
    lines.push('|---|---|---|---|---|');
    for (const f of v.excused) {
      lines.push(`| ${f.scope} | ${f.pkg} | ${f.ghsa} | ${f.expires} | ${f.reason} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const reports = process.argv.slice(2);
  if (!reports.length) throw new Error('usage: audit-gate.cjs <scope>=<file>:<pnpm|bun> ...');
  const findings = [];
  for (const spec of reports) {
    const m = /^([^=]+)=(.+):(pnpm|bun)$/.exec(spec);
    if (!m) throw new Error(`bad report spec "${spec}"`);
    const text = fs.readFileSync(m[2], 'utf8');
    // An empty or non-JSON report means the audit did not run; reading it as
    // "no findings" is exactly the blind-green this gate replaces.
    findings.push(...parseAudit(m[1], m[3], JSON.parse(text)));
  }
  const exceptions = JSON.parse(fs.readFileSync(EXCEPTIONS_PATH, 'utf8')).exceptions;
  const v = evaluate(findings, exceptions, new Date());
  const md = renderSummary(v);
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  if (v.blocking.length || v.expired.length || v.invalid.length) process.exit(1);
}

if (require.main === module) main();

module.exports = { parseAudit, evaluate, renderSummary };
