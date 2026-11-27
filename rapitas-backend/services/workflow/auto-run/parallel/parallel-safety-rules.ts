/**
 * parallel-safety-rules
 *
 * Pure pair rules that decide whether a candidate task may run at the same time
 * as a task already running (task 1552): dependency (table or text), plan
 * presence, conflict-prone files, file overlap, same folder and import relation.
 * Not responsible for reading plans, the DB or files — callers pass all in.
 */
import { parsePlanFiles } from '../../../agents/verification/scope-check';
import { parsePlanDeclaration } from '../../plan-deviation/declaration-parser';
import { overlappingFiles } from '../auto-run-selection';
import type { ParallelVerdict } from './parallel-types';
import { isLikelyFile } from './plan-file-tokens';
import {
  CONFLICT_PRONE_FILE_RULES,
  MIN_PATTERN_PREFIX_SEGMENTS,
  PACKAGE_DIR_RE,
  globHits,
  globToSuffixRegex,
  normPath as norm,
  type ConflictProneScope,
} from './conflict-prone-files';

/** A plan entry that matched a conflict-prone rule. */
export interface ConflictProneHit {
  file: string;
  reason: string;
  kind: string;
  scope: ConflictProneScope;
}

// Re-exported so callers and tests keep one import site for the pair rules.
export { CONFLICT_PRONE_FILE_RULES, globToSuffixRegex };

/** Files and glob patterns a plan names. */
export interface PlanFileSet {
  /** Concrete file paths. / 具体的なファイル */
  files: string[];
  /** Globs / directories (`a/b/**`, `a/b/`, `a/x*.ts`). / パターン */
  patterns: string[];
  /** Patterns dropped as too wide. / 広すぎて無視したパターン */
  ignoredPatterns: string[];
}

function literalPrefix(pattern: string): string {
  const star = pattern.indexOf('*');
  return star < 0 ? pattern : pattern.slice(0, star);
}

/**
 * Collect the files a plan names: parsePlanFiles ∪ the declaration's files.
 * Directory tokens and globs become patterns; shallow ones are ignored.
 *
 * @param plan - plan.md text / plan.md の内容
 * @returns File set / ファイル集合
 */
export function collectPlanFiles(plan: string | null | undefined): PlanFileSet {
  const out: PlanFileSet = { files: [], patterns: [], ignoredPatterns: [] };
  if (!plan) return out;
  const files = new Set<string>();
  const patterns = new Set<string>();
  const add = (raw: string, fromDeclaration: boolean) => {
    const p = norm(raw.trim());
    if (!p) return;
    if (p.includes('*')) patterns.add(p);
    // parsePlanFiles adds every file's parent directory; only a declared
    // directory is a deliberate scope claim, so the derived ones are dropped.
    else if (p.endsWith('/')) {
      if (fromDeclaration) patterns.add(`${p}**`);
    } else if (fromDeclaration || isLikelyFile(p)) files.add(p);
  };
  for (const f of parsePlanFiles(plan)) add(f, false);
  // A fallback declaration is scraped from prose, so it gets the prose filter.
  const { declaration, source } = parsePlanDeclaration(plan);
  for (const f of declaration.files) add(f, source !== 'fallback');
  for (const p of patterns) {
    const segments = literalPrefix(p).replace(PACKAGE_DIR_RE, 'pkg/').split('/').filter(Boolean);
    // A filename glob (`dir/name*.ts`) keeps its directory depth; a pure
    // directory glob needs MIN_PATTERN_PREFIX_SEGMENTS to be specific enough.
    const prefixDepth = literalPrefix(p).endsWith('/') ? segments.length : segments.length - 1;
    if (prefixDepth < MIN_PATTERN_PREFIX_SEGMENTS) out.ignoredPatterns.push(p);
    else out.patterns.push(p);
  }
  out.files = [...files];
  return out;
}

/** Whether the set names nothing comparable. */
export function isEmptyPlanFileSet(set: PlanFileSet): boolean {
  return set.files.length === 0 && set.patterns.length === 0;
}

/**
 * Conflict-prone files (or patterns) in a set.
 *
 * @param set - File set / ファイル集合
 * @returns Matching entries with the rule reason / 該当と理由
 */
export function conflictProneHits(set: PlanFileSet): ConflictProneHit[] {
  const hits: ConflictProneHit[] = [];
  const probes = [
    ...set.files,
    // A directory glob claims every file below it: probe one synthetic child.
    ...set.patterns.filter((p) => p.endsWith('/**')).map((p) => `${p.slice(0, -2)}__any__`),
  ];
  for (const file of probes) {
    const rule = CONFLICT_PRONE_FILE_RULES.find((r) => globHits(r.pattern, file));
    if (rule) {
      hits.push({
        file: file.replace(/__any__$/, '**'),
        reason: rule.reason,
        kind: rule.kind,
        scope: rule.scope,
      });
    }
  }
  return hits;
}

/**
 * The conflict-prone hits that make a pair unsafe: every any-scoped hit on
 * either side, plus pair-scoped hits whose kind both sides touch.
 *
 * @param a - One side / 片方
 * @param b - Other side / もう片方
 * @returns Hits that refuse the pair / 並列を拒む該当
 */
export function blockingConflictProneHits(a: PlanFileSet, b: PlanFileSet): ConflictProneHit[] {
  const ha = conflictProneHits(a);
  const hb = conflictProneHits(b);
  const pairKinds = (hits: ConflictProneHit[]) =>
    new Set(hits.filter((h) => h.scope === 'pair').map((h) => h.kind));
  const ka = pairKinds(ha);
  const kb = pairKinds(hb);
  return [...ha, ...hb].filter((h) => h.scope === 'any' || (ka.has(h.kind) && kb.has(h.kind)));
}

/**
 * Overlapping entries between two sets: the overlap guard's file rule
 * (`overlappingFiles`), plus patterns covering the other side's files, plus
 * nested pattern prefixes.
 *
 * @param a - One side / 片方
 * @param b - Other side / もう片方
 * @returns Overlapping entries / 重なり
 */
export function overlappingEntries(a: PlanFileSet, b: PlanFileSet): string[] {
  const out = new Set<string>(overlappingFiles(a.files, b.files));
  for (const [pats, files] of [
    [a.patterns, b.files],
    [b.patterns, a.files],
  ] as const) {
    for (const p of pats) for (const f of files) if (globHits(p, f)) out.add(f);
  }
  for (const pa of a.patterns) {
    for (const pb of b.patterns) {
      const la = literalPrefix(pa).replace(PACKAGE_DIR_RE, '');
      const lb = literalPrefix(pb).replace(PACKAGE_DIR_RE, '');
      if (la.startsWith(lb) || lb.startsWith(la)) out.add(`${pa} ~ ${pb}`);
    }
  }
  return [...out];
}

function dirOf(file: string): string {
  const i = file.lastIndexOf('/');
  return i > 0 ? file.slice(0, i) : '';
}

/**
 * Folders both sides touch (parent folder only, suffix-matched like files).
 *
 * @param a - One side / 片方
 * @param b - Other side / もう片方
 * @returns Shared folders / 共通フォルダ
 */
export function sharedDirectories(a: PlanFileSet, b: PlanFileSet): string[] {
  const out = new Set<string>();
  for (const fa of a.files) {
    const da = dirOf(fa);
    if (!da) continue;
    for (const fb of b.files) {
      const db = dirOf(fb);
      if (db && (da === db || da.endsWith(`/${db}`) || db.endsWith(`/${da}`))) out.add(da);
    }
  }
  return [...out];
}

const JA_DEP_RE =
  /(?<![\w/.:-])(?:タスク\s*)?#?(\d{2,6})\s*(?:番)?\s*(?:に依存|の完了後|の後|が完了してから|がマージされてから|のマージ後)/g;
const EN_DEP_RE = /\b(?:depends on|after|blocked by)\s+(?:task\s*)?#(\d{2,6})\b/gi;

/**
 * Task ids a text says it depends on. Only a dependency predicate right after
 * the number counts, so a passing mention (`#1543 で追加した`) is ignored.
 *
 * @param text - Description or plan / 説明や計画
 * @param selfId - The text's own task id (ignored) / 自身のタスクID
 * @returns Unique ids / 依存先ID
 */
export function extractDependencyRefs(text: string | null | undefined, selfId: number): number[] {
  if (!text) return [];
  const out = new Set<number>();
  for (const re of [JA_DEP_RE, EN_DEP_RE]) {
    for (const m of text.matchAll(re)) {
      const id = Number(m[1]);
      if (Number.isSafeInteger(id) && id !== selfId) out.add(id);
    }
  }
  return [...out];
}

/** One task of the pair. */
export interface PairSide {
  taskId: number;
  plan: string | null;
  description: string | null;
}

/** Facts about the pair gathered by the caller. */
export interface PairContext {
  /** Same theme: a missing plan refuses (fail-closed). Other theme: file rules pass. */
  requirePlans: boolean;
  /** A TaskDependency row links the two either way. / 依存テーブルで繋がっている */
  tableLinked: boolean;
  /** Ids the candidate's text names that exist and are not done. / 未完了の依存先 */
  incompleteTaskIds: ReadonlySet<number>;
  /** Import relation between the two sides' files; undefined = not checked. */
  importRelated?: boolean;
}

const reject = (reason: string, detail: string): ParallelVerdict => ({ ok: false, reason, detail });
const list = (xs: string[]) => xs.slice(0, 10).join(', ');

/**
 * Decide whether `candidate` may run next to `active`.
 *
 * @param candidate - Task about to be selected / 選定候補
 * @param active - Task already running / 動作中のタスク
 * @param ctx - Pair facts / 組の事実
 * @returns ok, or the first refusal reason / 判定
 */
export function judgePair(
  candidate: PairSide,
  active: PairSide,
  ctx: PairContext,
): ParallelVerdict {
  if (ctx.tableLinked) {
    return reject('dependency_link', `task ${candidate.taskId} and ${active.taskId} are linked`);
  }
  const candRefs = [
    ...extractDependencyRefs(candidate.description, candidate.taskId),
    ...extractDependencyRefs(candidate.plan, candidate.taskId),
  ];
  const activeRefs = [
    ...extractDependencyRefs(active.description, active.taskId),
    ...extractDependencyRefs(active.plan, active.taskId),
  ];
  if (candRefs.includes(active.taskId) || activeRefs.includes(candidate.taskId)) {
    return reject(
      'dependency_text',
      `text names a dependency between ${candidate.taskId} and ${active.taskId}`,
    );
  }
  const unmet = candRefs.filter((id) => ctx.incompleteTaskIds.has(id));
  if (unmet.length > 0) {
    return reject(
      'dependency_text',
      `depends on unfinished task(s) ${[...new Set(unmet)].join(', ')}`,
    );
  }

  const cand = collectPlanFiles(candidate.plan);
  const act = collectPlanFiles(active.plan);
  const candMissing = isEmptyPlanFileSet(cand);
  const actMissing = isEmptyPlanFileSet(act);
  if (candMissing || actMissing) {
    if (!ctx.requirePlans) return { ok: true };
    return candMissing
      ? reject('candidate_plan_missing', `task ${candidate.taskId} has no plan files`)
      : reject('active_plan_missing', `running task ${active.taskId} has no plan files`);
  }

  const prone = blockingConflictProneHits(cand, act);
  if (prone.length > 0) {
    return reject('conflict_prone_file', list(prone.map((h) => `${h.file} (${h.reason})`)));
  }
  const overlap = overlappingEntries(cand, act);
  if (overlap.length > 0) return reject('file_overlap', list(overlap));
  const dirs = sharedDirectories(cand, act);
  if (dirs.length > 0) return reject('same_directory', list(dirs));
  if (ctx.importRelated) {
    return reject(
      'import_relation',
      `files of ${candidate.taskId} and ${active.taskId} import each other`,
    );
  }
  return { ok: true };
}
