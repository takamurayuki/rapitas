/**
 * Private-Set Eval Runner
 *
 * Loads eval/private-set/cases/*.json, validates each against the EvalCase
 * schema, runs each case's acceptanceCheck, and reports fail-to-pass /
 * pass-to-pass counts using the same grouped pass/fail + non-zero exit code
 * style as scripts/eval-gates.ts. This is a separate, LLM/end-to-end oriented
 * harness — see docs/eval-private-set.md for why it does not replace
 * eval-gates.ts (deterministic gate-logic evaluation only).
 *
 * Sets RAPITAS_EVAL_MODE=true for the duration of this process only; nothing
 * outside this script's own child invocations observes it (see
 * docs/eval-private-set.md — normal dev.js / index.ts startup is untouched).
 *
 * Usage: bun run scripts/eval-runner.ts --case-dir eval/private-set/cases
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { validateEvalCase, type EvalCase } from '../eval/private-set/case-schema';

const execAsync = promisify(exec);

process.env.RAPITAS_EVAL_MODE = 'true';

const DEFAULT_CASE_DIR = resolve(import.meta.dir, '..', 'eval', 'private-set', 'cases');
const CHECK_TIMEOUT_MS = 60_000;

/** Outcome of running one case's acceptanceCheck. */
export interface CaseResult {
  id: string;
  category: string;
  expectedOutcome: string;
  ran: boolean;
  passed: boolean;
  error?: string;
}

/**
 * Resolves the `--case-dir` CLI argument, or the default eval/private-set/cases.
 *
 * @param argv - process.argv-style args (excluding node/script) / CLI引数
 * @returns Absolute directory path / 解決済みの絶対パス
 */
export function resolveCaseDir(argv: string[]): string {
  const flag = argv.find((a) => a.startsWith('--case-dir'));
  if (!flag) return DEFAULT_CASE_DIR;
  const eqIdx = flag.indexOf('=');
  if (eqIdx !== -1) return resolve(flag.slice(eqIdx + 1));
  const idx = argv.indexOf(flag);
  const value = argv[idx + 1];
  return value ? resolve(value) : DEFAULT_CASE_DIR;
}

/**
 * Loads and validates every `*.json` file in a case directory. Invalid files
 * are reported via the `invalid` list rather than throwing, so one bad case
 * doesn't abort the whole run.
 *
 * @param caseDir - Absolute directory containing case JSON files / ケースJSONの格納ディレクトリ
 * @returns Valid cases and validation failures / 有効なケースと検証失敗一覧
 */
export function loadCases(caseDir: string): {
  cases: EvalCase[];
  invalid: Array<{ file: string; errors: string[] }>;
} {
  const cases: EvalCase[] = [];
  const invalid: Array<{ file: string; errors: string[] }> = [];

  let files: string[] = [];
  try {
    files = readdirSync(caseDir).filter((f) => f.endsWith('.json'));
  } catch {
    return { cases, invalid };
  }

  for (const file of files) {
    const full = join(caseDir, file);
    try {
      const parsed: unknown = JSON.parse(readFileSync(full, 'utf-8'));
      const validation = validateEvalCase(parsed);
      if (validation.ok) {
        cases.push(parsed as EvalCase);
      } else {
        invalid.push({ file, errors: validation.errors });
      }
    } catch (err) {
      invalid.push({ file, errors: [err instanceof Error ? err.message : String(err)] });
    }
  }

  return { cases, invalid };
}

/**
 * Runs one case's `acceptanceCheck` shell command and classifies pass/fail
 * against its `expectedOutcome`.
 *
 * @param evalCase - The case to run / 実行対象ケース
 * @param runFn - Injectable command runner for unit tests / テスト用インジェクション可能な実行関数
 * @returns The case's result / 実行結果
 */
export async function runCase(
  evalCase: EvalCase,
  runFn: (cmd: string) => Promise<void> = async (cmd) => {
    await execAsync(cmd, { timeout: CHECK_TIMEOUT_MS });
  },
): Promise<CaseResult> {
  try {
    await runFn(evalCase.acceptanceCheck);
    return {
      id: evalCase.id,
      category: evalCase.category,
      expectedOutcome: evalCase.expectedOutcome,
      ran: true,
      passed: true,
    };
  } catch (err) {
    return {
      id: evalCase.id,
      category: evalCase.category,
      expectedOutcome: evalCase.expectedOutcome,
      ran: true,
      passed: false,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    };
  }
}

/** Aggregate counts for a set of {@link CaseResult}. */
export interface EvalSummary {
  total: number;
  passed: number;
  failToPassCount: number;
  failToPassPassed: number;
  passToPassCount: number;
  passToPassPassed: number;
}

/**
 * Aggregates fail-to-pass / pass-to-pass counts from case results.
 *
 * @param results - Per-case results / ケースごとの実行結果
 * @returns Aggregate summary / 集計結果
 */
export function summarize(results: CaseResult[]): EvalSummary {
  const summary: EvalSummary = {
    total: results.length,
    passed: 0,
    failToPassCount: 0,
    failToPassPassed: 0,
    passToPassCount: 0,
    passToPassPassed: 0,
  };
  for (const r of results) {
    if (r.passed) summary.passed++;
    if (r.expectedOutcome === 'fail-to-pass') {
      summary.failToPassCount++;
      if (r.passed) summary.failToPassPassed++;
    } else if (r.expectedOutcome === 'pass-to-pass') {
      summary.passToPassCount++;
      if (r.passed) summary.passToPassPassed++;
    }
  }
  return summary;
}

async function main(): Promise<void> {
  const caseDir = resolveCaseDir(process.argv.slice(2));
  const { cases, invalid } = loadCases(caseDir);

  if (invalid.length > 0) {
    console.error(`[eval-runner] ${invalid.length} invalid case file(s):`);
    for (const i of invalid) console.error(`  - ${i.file}: ${i.errors.join('; ')}`);
  }

  if (cases.length === 0) {
    console.log('[eval-runner] 0 case(s) found — nothing to run.');
    process.exit(invalid.length > 0 ? 1 : 0);
  }

  const results: CaseResult[] = [];
  for (const c of cases) {
    results.push(await runCase(c));
  }

  const summary = summarize(results);
  console.log(
    `[eval-runner] ${summary.passed}/${summary.total} case(s) passed | ` +
      `fail-to-pass: ${summary.failToPassPassed}/${summary.failToPassCount} | ` +
      `pass-to-pass: ${summary.passToPassPassed}/${summary.passToPassCount}`,
  );
  for (const r of results) {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.id} (${r.category}/${r.expectedOutcome})`);
  }

  process.exit(invalid.length === 0 && summary.passed === summary.total ? 0 : 1);
}

if (import.meta.main) {
  await main();
}
