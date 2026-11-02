/**
 * close-linked-issues
 *
 * Closes the issues a merged PR names with a closing keyword when the PR was
 * merged into a non-default branch. GitHub acts on `Closes #N` only for merges
 * into the default branch (`main`), and work here merges into `develop`, so
 * without this a fixed issue stays open indefinitely (#1365: 131 of 150 open
 * issues were already fixed). It does not judge whether the PR really finished
 * the issue — that is what `Closes` vs `Refs` in the PR body is for.
 *
 * Usage (CI):
 *   node scripts/github/close-linked-issues.cjs event   # reads GITHUB_EVENT_PATH
 *   node scripts/github/close-linked-issues.cjs sweep   # recently merged PRs
 * Env: GITHUB_REPOSITORY, DEFAULT_BRANCH (default "main"), SWEEP_DAYS (default 14), GH_TOKEN.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

// NOTE: GitHub's own keyword list. The lookbehind stops "prefixes"/"unresolved"
// reading as "fixes"/"resolved".
const KEYWORD = String.raw`(?<![\w-])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*`;
const REF = String.raw`(?:#(\d+)|([\w.-]+\/[\w.-]+)#(\d+)|https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+))(?!\d)`;

/**
 * Remove fenced and inline code, where a quoted "Closes #N" is an example, not an instruction.
 *
 * @param text - Markdown body / PR本文
 * @returns The body without code / コードを除いた本文
 */
function stripCode(text) {
  return text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '').replace(/`[^`\n]*`/g, '');
}

/**
 * Issue numbers of `repo` that a PR body closes, in GitHub's keyword grammar.
 *
 * @param body - PR body / PR本文
 * @param repo - "owner/name" of this repository / 対象リポジトリ
 * @returns Sorted, unique issue numbers / 閉じる issue 番号（昇順・重複なし）
 */
function extractClosingRefs(body, repo) {
  const out = new Set();
  const re = new RegExp(KEYWORD + REF, 'gi');
  for (const m of stripCode(body || '').matchAll(re)) {
    const [, local, otherRepo, otherNum, urlRepo, urlNum] = m;
    if (local) out.add(Number(local));
    else if (otherRepo && otherRepo.toLowerCase() === repo.toLowerCase()) out.add(Number(otherNum));
    else if (urlRepo && urlRepo.toLowerCase() === repo.toLowerCase()) out.add(Number(urlNum));
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Close the open issues a merged PR names, unless GitHub already does (default branch).
 *
 * @param opts.pr - { number, merged, base, body, mergedAt? } / マージされたPR
 * @param opts.repo - "owner/name" / リポジトリ
 * @param opts.defaultBranch - The branch GitHub handles natively / 既定ブランチ
 * @param opts.gh - Runs `gh` with an argv array and returns stdout / gh 実行関数
 * @returns { closed, skipped, failed } / 結果
 */
function closeLinkedIssues({ pr, repo, defaultBranch, gh }) {
  const result = { closed: [], skipped: [], failed: [] };
  if (!pr.merged || pr.base === defaultBranch) return result;
  for (const n of extractClosingRefs(pr.body, repo)) {
    let issue;
    try {
      issue = JSON.parse(gh(['api', `repos/${repo}/issues/${n}`]));
    } catch (e) {
      result.skipped.push({ n, why: `lookup failed: ${e.message}` });
      continue;
    }
    if (issue.pull_request) {
      result.skipped.push({ n, why: 'is a pull request' });
      continue;
    }
    if (issue.state !== 'open') {
      result.skipped.push({ n, why: `already ${issue.state}` });
      continue;
    }
    // NOTE: A reopen after the merge is a person saying "not finished". The daily
    // sweep revisits the same PRs for two weeks and must not keep undoing that.
    if (pr.mergedAt) {
      let events;
      try {
        events = JSON.parse(
          gh(['api', `repos/${repo}/issues/${n}/events`, '-X', 'GET', '-f', 'per_page=100']),
        );
      } catch (e) {
        result.skipped.push({ n, why: `event lookup failed: ${e.message}` });
        continue;
      }
      if (events.some((ev) => ev.event === 'reopened' && ev.created_at >= pr.mergedAt)) {
        result.skipped.push({ n, why: 'reopened after the PR merged' });
        continue;
      }
    }
    const comment =
      `Closed by #${pr.number}, merged into \`${pr.base}\`.\n\n` +
      `GitHub only acts on closing keywords for merges into \`${defaultBranch}\`, so this is done by ` +
      '`close-linked-issues`. If that PR only partly addresses this issue, reopen it — a partial PR ' +
      'should say `Refs #N`, not `Closes #N`.';
    try {
      gh([
        'issue',
        'close',
        String(n),
        '--repo',
        repo,
        '--reason',
        'completed',
        '--comment',
        comment,
      ]);
      result.closed.push(n);
    } catch (e) {
      result.failed.push({ n, why: e.message });
    }
  }
  return result;
}

/**
 * Re-apply the rule to PRs merged in the last `days` days, so a missed or failed run is caught up.
 *
 * @param opts.days - Look-back window in days / 遡る日数
 * @param opts.now - Current time (injectable for tests) / 現在時刻
 * @returns Merged { closed, skipped, failed } over all PRs / 結果
 */
function sweep({ repo, defaultBranch, days, gh, now = new Date() }) {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const prs = JSON.parse(
    gh([
      'pr',
      'list',
      '--repo',
      repo,
      '--state',
      'merged',
      '--limit',
      '500',
      '--search',
      `merged:>=${since}`,
      '--json',
      'number,baseRefName,body,mergedAt',
    ]),
  );
  const total = { closed: [], skipped: [], failed: [] };
  for (const p of prs) {
    const r = closeLinkedIssues({
      pr: {
        number: p.number,
        merged: true,
        base: p.baseRefName,
        body: p.body,
        mergedAt: p.mergedAt,
      },
      repo,
      defaultBranch,
      gh,
    });
    for (const k of Object.keys(total)) total[k].push(...r[k]);
  }
  return total;
}

function realGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// GitHub's own hiccups, as `gh` reports them. Anything else (404, 403, a bad
// argument) is an answer, not a blip, and retrying it only delays the red run.
const TRANSIENT = /Something went wrong|HTTP 5\d\d|timed? ?out|ECONNRESET|EAI_AGAIN/i;

/**
 * Wrap a gh runner so a transient GitHub failure is retried.
 *
 * Exists because #1371's merge left #1132 open: a single GraphQL "Something
 * went wrong" failed the close, and nothing retried it until the daily sweep.
 *
 * @param {(args: string[]) => string} gh - Runner to wrap / ラップする gh 実行関数
 * @param {{ attempts?: number, wait?: (ms: number) => void }} [opts] - Tries and back-off / 試行回数と待機
 * @returns {(args: string[]) => string} The retrying runner / 再試行つき実行関数
 */
function retryingGh(gh, { attempts = 3, wait = sleepSync } = {}) {
  return (args) => {
    for (let i = 1; ; i++) {
      try {
        return gh(args);
      } catch (err) {
        const text = `${err && err.message}\n${(err && err.stderr) || ''}`;
        if (i >= attempts || !TRANSIENT.test(text)) throw err;
        wait(2000 * i);
      }
    }
  };
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function main() {
  const mode = process.argv[2];
  const repo = process.env.GITHUB_REPOSITORY;
  const defaultBranch = process.env.DEFAULT_BRANCH || 'main';
  if (!repo) throw new Error('GITHUB_REPOSITORY is required');
  let r;
  if (mode === 'event') {
    const ev = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const p = ev.pull_request;
    r = closeLinkedIssues({
      pr: {
        number: p.number,
        merged: p.merged === true,
        base: p.base.ref,
        body: p.body,
        mergedAt: p.merged_at,
      },
      repo,
      defaultBranch,
      gh: retryingGh(realGh),
    });
  } else if (mode === 'sweep') {
    r = sweep({
      repo,
      defaultBranch,
      days: Number(process.env.SWEEP_DAYS || 14),
      gh: retryingGh(realGh),
    });
  } else {
    throw new Error(`unknown mode "${mode}" (event | sweep)`);
  }
  console.log(JSON.stringify(r, null, 2));
  // A close that failed must turn the run red; a skip is an expected outcome.
  if (r.failed.length) process.exit(1);
}

if (require.main === module) main();

module.exports = { extractClosingRefs, closeLinkedIssues, sweep, retryingGh };
