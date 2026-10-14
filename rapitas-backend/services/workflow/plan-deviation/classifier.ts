/**
 * plan-deviation/classifier
 *
 * Classifies recorded operations against a plan declaration into
 * 計画内 / 計画外 / 計画にあるが未実行, in chronological order. Implements
 * the judging pseudo-code in plan.md verbatim — the step order matters.
 * Pure function; no I/O.
 */
import { matchesAnyPattern, matchesPattern } from './glob-match';
import type {
  DeviationByKind,
  DeviationCounts,
  OperationKind,
  OperationRecord,
  ParsedDeclaration,
  TimelineEntry,
} from './types';

/**
 * Commands never treated as deviations: read-only utilities and shell
 * builtins. Requiring plans to declare these would flood 『計画外』.
 */
export const ALWAYS_ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  'cd',
  'echo',
  'cat',
  'ls',
  'head',
  'tail',
  'grep',
  'rg',
  'pwd',
  'wc',
  'sort',
  'uniq',
  'sed',
  'awk',
  'find',
  'true',
  'false',
  'test',
  'printf',
  'which',
  'where',
  'dir',
  'type',
  'set',
  'export',
  'sleep',
]);

/** Hosts the agent always talks to (its own backend). */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1']);

/** Result of classification (status is 'ok' or 'ambiguous' here). */
export interface ClassificationResult {
  status: 'ok' | 'ambiguous';
  entries: TimelineEntry[];
  counts: DeviationCounts | null;
  byKind: DeviationByKind | null;
}

/** Whether a host matches a declared host (exact, or `*.x.com` for strict subdomains). */
function hostMatches(host: string, declared: string): boolean {
  if (declared.startsWith('*.')) return host.endsWith(declared.slice(1));
  return host === declared;
}

/** Category of one operation per step 2 of the pseudo-code. */
function categorize(
  op: OperationRecord,
  parsed: ParsedDeclaration,
  workDir?: string | null,
): TimelineEntry['category'] {
  const { files, commands, externalHosts } = parsed.declaration;
  if (op.kind === 'file_change') {
    return op.features.path && matchesAnyPattern(op.features.path, files, workDir)
      ? 'in_plan'
      : 'out_of_plan';
  }
  if (op.kind === 'command') {
    if (commands.length === 0) return 'skipped';
    const declared = commands.map((c) => c.toLowerCase());
    const names = (op.features.commandNames ?? []).filter((n) => !ALWAYS_ALLOWED_COMMANDS.has(n));
    return names.every((n) => declared.includes(n)) ? 'in_plan' : 'out_of_plan';
  }
  const hosts = (op.features.hosts ?? []).filter((h) => !LOOPBACK_HOSTS.has(h));
  return hosts.every((h) => externalHosts.some((d) => hostMatches(h, d)))
    ? 'in_plan'
    : 'out_of_plan';
}

/** Declared items no operation exercised, per step 3. */
function unexercisedItems(
  ops: OperationRecord[],
  parsed: ParsedDeclaration,
  workDir?: string | null,
): Array<{ kind: OperationKind; item: string }> {
  const { files, commands, externalHosts } = parsed.declaration;
  const out: Array<{ kind: OperationKind; item: string }> = [];
  for (const pattern of files) {
    const used = ops.some(
      (o) =>
        o.kind === 'file_change' &&
        o.features.path &&
        matchesPattern(o.features.path, pattern, workDir),
    );
    if (!used) out.push({ kind: 'file_change', item: pattern });
  }
  for (const name of commands) {
    const lower = name.toLowerCase();
    if (!ops.some((o) => o.kind === 'command' && o.features.commandNames?.includes(lower))) {
      out.push({ kind: 'command', item: name });
    }
  }
  for (const host of externalHosts) {
    if (
      !ops.some((o) => o.kind === 'http' && o.features.hosts?.some((h) => hostMatches(h, host)))
    ) {
      out.push({ kind: 'http', item: host });
    }
  }
  return out;
}

/**
 * Classify operations against the declaration.
 *
 * @param parsed - Parsed plan declaration / 解析済みの計画宣言
 * @param ops - Recorded operations (any order) / 記録された操作
 * @param executionTerminal - Whether the execution has finished / 実行が終了済みか
 * @param workDir - Execution working directory for path normalization / 作業ディレクトリ
 * @returns Chronological entries plus counts; counts null when ambiguous / 時系列エントリと件数
 */
export function classifyOperations(
  parsed: ParsedDeclaration,
  ops: OperationRecord[],
  executionTerminal: boolean,
  workDir?: string | null,
): ClassificationResult {
  // Step 1 — a plan without file patterns must not be used for judging (Q4).
  if (parsed.ambiguous) return { status: 'ambiguous', entries: [], counts: null, byKind: null };

  const sorted = [...ops].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.seq - b.seq);
  const entries: TimelineEntry[] = sorted.map((op) => ({
    category: categorize(op, parsed, workDir),
    kind: op.kind,
    seq: op.seq,
    occurredAt: op.occurredAt,
    tool: op.tool,
    display: op.displayMasked,
    logSequence: op.logSequence,
  }));

  for (const { kind, item } of unexercisedItems(sorted, parsed, workDir)) {
    entries.push({
      category: executionTerminal ? 'planned_not_executed' : 'pending',
      kind,
      display: item,
      declaredItem: item,
    });
  }

  const counts: DeviationCounts = { inPlan: 0, outOfPlan: 0, plannedNotExecuted: 0 };
  const byKind: DeviationByKind = { file_change: 0, command: 0, http: 0 };
  for (const e of entries) {
    if (e.category === 'in_plan') counts.inPlan++;
    if (e.category === 'out_of_plan') counts.outOfPlan++;
    if (e.category === 'planned_not_executed') counts.plannedNotExecuted++;
    if (e.category === 'out_of_plan' || e.category === 'planned_not_executed') byKind[e.kind]++;
  }
  return { status: 'ok', entries, counts, byKind };
}
