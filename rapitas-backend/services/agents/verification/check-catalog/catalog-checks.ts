/**
 * check-catalog/catalog-checks
 *
 * Runners for the catalog checks the self-verifier adds to match the real
 * gates (task 1602): import-graph, docs-drift and the HACK/FIXME ceilings run
 * the same scripts CI runs; secret and attribution dry-run the pre-save
 * screens without staging or committing anything. Each one fails only on a
 * violation the diff is responsible for, so a red base never blocks a task.
 * Not responsible for the overall verdict.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runCmd, type CmdResult } from '../verify-command-runner';
import { MAX_DETAIL_CHARS, type VerificationCheck } from '../verification-check-types';
import { TODO_CEILINGS } from './catalog';
import { attributeWorkingTree, scanForSecrets } from './presave-scan';

/** Each script walks the whole repository; a minute is far above the measured run time. */
const SCRIPT_TIMEOUT_MS = 60_000;

const norm = (p: string) => p.replace(/\\/g, '/');
const changedSet = (files: string[]) => new Set(files.map(norm));

/** A check that could not run; it never fails the gate. */
function notRun(name: VerificationCheck['name'], details: string): VerificationCheck {
  return { name, ran: false, ok: true, errorCount: 0, details };
}

/** Run one repo script with node, or null when the script is absent. */
async function runScript(workdir: string, rel: string, args: string): Promise<CmdResult | null> {
  const script = join(workdir, rel);
  if (!existsSync(script)) return null;
  return runCmd(`node "${script}"${args}`, workdir, {
    heavy: true,
    timeoutMs: SCRIPT_TIMEOUT_MS,
  });
}

/** A run that did not produce a verdict (timeout, crash, signal). */
const brokenRun = (res: CmdResult) => res.code === 124 || res.failure !== undefined;

const IMPORT_GRAPH_LINE_RE =
  /^\s*(NEW direction violation|NEW import cycle|STALE baseline entry)\s+(.+)$/;

/**
 * CI's "Import direction and cycles": fails on a NEW/STALE entry naming a file
 * the diff changed.
 *
 * @param workdir - Worktree root / worktree ルート
 * @param allChanged - Every changed path / 全変更パス
 * @returns The import-graph check / 検査結果
 */
export async function importGraphCheck(
  workdir: string,
  allChanged: string[],
): Promise<VerificationCheck> {
  const res = await runScript(workdir, 'scripts/import-graph/check-import-graph.cjs', '');
  if (!res) return notRun('import-graph', 'import-graph: script not present (skipped)');
  if (brokenRun(res))
    return notRun('import-graph', 'import-graph: script did not finish (skipped)');
  if (res.code === 0) {
    return {
      name: 'import-graph',
      ran: true,
      ok: true,
      errorCount: 0,
      details: 'import-graph: OK',
    };
  }
  const changed = changedSet(allChanged);
  const own: string[] = [];
  const files = new Set<string>();
  let total = 0;
  for (const line of `${res.stdout}\n${res.stderr}`.split(/\r?\n/)) {
    const m = IMPORT_GRAPH_LINE_RE.exec(line);
    if (!m) continue;
    total++;
    const hits = m[2]!.split(/\s+/).filter((t) => changed.has(norm(t)));
    if (hits.length === 0) continue;
    own.push(line.trim());
    for (const h of hits) files.add(norm(h));
  }
  if (total === 0) return notRun('import-graph', 'import-graph: unparseable output (skipped)');
  return {
    name: 'import-graph',
    ran: true,
    ok: own.length === 0,
    errorCount: own.length,
    failureFiles: own.length ? [...files] : undefined,
    details: own.length
      ? `この差分が起こした import の層違反・循環:\n${own.join('\n')}`.slice(0, MAX_DETAIL_CHARS)
      : `import-graph: この差分の違反はありません（既存の違反 ${total} 件は対象外）`,
  };
}

interface DriftProblem {
  kind: string;
  doc?: string;
  name?: string;
  readers?: string[];
  message: string;
}

const ENV_CONFIG = ['rapitas-backend/.env.example', 'scripts/docs/env-baseline.json'];

/**
 * CI's "Docs match the code": fails on a problem in a changed doc, an env var
 * read by a changed file, or an env problem after a changed env config.
 *
 * @param workdir - Worktree root / worktree ルート
 * @param allChanged - Every changed path / 全変更パス
 * @returns The docs-drift check / 検査結果
 */
export async function docsDriftCheck(
  workdir: string,
  allChanged: string[],
): Promise<VerificationCheck> {
  const res = await runScript(workdir, 'scripts/docs/check-docs-drift.cjs', ' --json');
  if (!res) return notRun('docs-drift', 'docs-drift: script not present (skipped)');
  if (brokenRun(res)) return notRun('docs-drift', 'docs-drift: script did not finish (skipped)');
  let problems: DriftProblem[];
  try {
    const last = res.stdout.trim().split(/\r?\n/).pop() ?? '';
    problems = (JSON.parse(last) as { problems: DriftProblem[] }).problems;
  } catch {
    return notRun('docs-drift', 'docs-drift: no --json output (skipped)');
  }
  const changed = changedSet(allChanged);
  const envConfigChanged = ENV_CONFIG.some((f) => changed.has(f));
  const files = new Set<string>();
  const own = problems.filter((p) => {
    const hits = [p.doc ?? '', ...(p.readers ?? [])].filter((f) => changed.has(f));
    for (const h of hits) files.add(h);
    if (hits.length === 0 && p.kind.startsWith('env') && envConfigChanged) {
      for (const f of ENV_CONFIG.filter((c) => changed.has(c))) files.add(f);
      return true;
    }
    return hits.length > 0;
  });
  return {
    name: 'docs-drift',
    ran: true,
    ok: own.length === 0,
    errorCount: own.length,
    failureFiles: own.length ? [...files] : undefined,
    details: own.length
      ? `この差分が起こした文書とコードの食い違い:\n${own.map((p) => p.message).join('\n')}`.slice(
          0,
          MAX_DETAIL_CHARS,
        )
      : `docs-drift: この差分の問題はありません（既存の問題 ${problems.length} 件は対象外）`,
  };
}

/**
 * CI's HACK/FIXME ceilings: fails when a tag is over its ceiling AND the diff
 * carries a marker of that tag. An over-ceiling base alone passes.
 *
 * @param workdir - Worktree root / worktree ルート
 * @param allChanged - Every changed path / 全変更パス
 * @returns The todos check / 検査結果
 */
export async function todosCheck(
  workdir: string,
  allChanged: string[],
): Promise<VerificationCheck> {
  const args = ` --json --max-hack ${TODO_CEILINGS.hack} --max-fixme ${TODO_CEILINGS.fixme}`;
  const res = await runScript(workdir, 'scripts/check-todos.cjs', args);
  if (!res) return notRun('todos', 'todos: script not present (skipped)');
  if (brokenRun(res)) return notRun('todos', 'todos: script did not finish (skipped)');
  let parsed: { counts: Record<string, number>; findings: Array<{ file: string; tag: string }> };
  try {
    parsed = JSON.parse(res.stdout.slice(res.stdout.indexOf('{')));
  } catch {
    return notRun('todos', 'todos: no --json output (skipped)');
  }
  const ceilings: Record<string, number> = { HACK: TODO_CEILINGS.hack, FIXME: TODO_CEILINGS.fixme };
  const over = Object.keys(ceilings).filter((t) => (parsed.counts[t] ?? 0) > ceilings[t]!);
  const changed = changedSet(allChanged);
  const own = parsed.findings.filter((f) => over.includes(f.tag) && changed.has(norm(f.file)));
  const counts = over.map((t) => `${t} ${parsed.counts[t]}/${ceilings[t]}`).join(', ');
  return {
    name: 'todos',
    ran: true,
    ok: own.length === 0,
    errorCount: own.length,
    failureFiles: own.length ? [...new Set(own.map((f) => norm(f.file)))] : undefined,
    details: own.length
      ? `上限を超えた印をこの差分が足しています（${counts}）:\n${own.map((f) => f.file).join('\n')}`
      : over.length
        ? `todos: 既存分だけで上限を超えています（${counts}）。この差分は印を足していません`
        : 'todos: within the HACK/FIXME ceilings',
  };
}

/**
 * Pre-save secret screen, dry-run: reads the changed files, stages nothing.
 *
 * @param workdir - Worktree root / worktree ルート
 * @param allChanged - Every changed path / 全変更パス
 * @returns The secret check / 検査結果
 */
export async function secretCheck(
  workdir: string,
  allChanged: string[],
): Promise<VerificationCheck> {
  const hits = await scanForSecrets(workdir, allChanged);
  return {
    name: 'secret',
    ran: true,
    ok: hits.length === 0,
    errorCount: hits.length,
    failureFiles: hits.length ? hits.map(norm) : undefined,
    details: hits.length
      ? `秘密情報らしいファイル・文字列（保存前の検査がコミットを止めます）:\n${hits.join('\n')}`
      : 'secret: no secret-looking file or token in the diff',
  };
}

/**
 * Pre-save attribution screen, dry-run. Advisory: it depends on file mtimes
 * and the implementer cannot change which session touched a file.
 *
 * @param workdir - Worktree root / worktree ルート
 * @param allChanged - Every changed path / 全変更パス
 * @param taskId - Task whose sessions own the worktree / 対象タスク
 * @returns The attribution check / 検査結果
 */
export async function attributionCheck(
  workdir: string,
  allChanged: string[],
  taskId: number | undefined,
): Promise<VerificationCheck> {
  if (taskId === undefined || allChanged.length === 0) {
    return {
      ...notRun('attribution', 'attribution: no task or no change (skipped)'),
      advisory: true,
    };
  }
  // An advisory screen must never take the verifier down with it (a DB error,
  // or a test double without agentSession).
  const verdict = await attributeWorkingTree({
    taskId,
    gitCwd: workdir,
    changedFiles: allChanged,
  }).catch(() => null);
  if (!verdict) {
    return {
      ...notRun('attribution', 'attribution: sessions unreadable (skipped)'),
      advisory: true,
    };
  }
  return {
    name: 'attribution',
    ran: true,
    ok: verdict.ok,
    errorCount: verdict.unattributed.length,
    advisory: true,
    failureFiles: verdict.ok ? undefined : verdict.unattributed.map(norm),
    details: verdict.ok
      ? 'attribution: every changed file belongs to this task'
      : `このタスクの作業と結び付けられないファイル（参考）:\n${verdict.unattributed.join('\n')}`,
  };
}

/**
 * Run every catalog parity check, in catalog order.
 *
 * @param workdir - Worktree root / worktree ルート
 * @param allChanged - Every changed path / 全変更パス
 * @param taskId - Task id for the attribution screen / 対象タスク
 * @returns The five checks / 検査結果
 */
export async function runCatalogChecks(
  workdir: string,
  allChanged: string[],
  taskId?: number,
): Promise<VerificationCheck[]> {
  return [
    await importGraphCheck(workdir, allChanged),
    await docsDriftCheck(workdir, allChanged),
    await todosCheck(workdir, allChanged),
    await secretCheck(workdir, allChanged),
    await attributionCheck(workdir, allChanged, taskId),
  ];
}
