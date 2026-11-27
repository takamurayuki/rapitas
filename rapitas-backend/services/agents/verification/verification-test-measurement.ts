/**
 * verification-test-measurement
 *
 * Runs one scoped test command with a machine-readable reporter attached and
 * reads back how many test CASES passed (Bun JUnit / Vitest JSON). Not
 * responsible for choosing commands, judging pass/fail or triaging failures —
 * that stays in automated-verifier.ts; this only adds the structured count.
 */
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

export type MeasuredRunner = 'bun' | 'vitest';

/** Result shape of the verifier's command runner (structural, to avoid a cycle). */
export interface MeasuredCmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

type RunCmd = (command: string, cwd: string, timeoutMs: number) => Promise<MeasuredCmdResult>;

/**
 * Detect the runner of a scoped test command built by related-tests.ts.
 *
 * @param command - Shell command / 実行コマンド
 * @returns The runner, or null for commands whose report format is unknown / ランナー。不明なら null
 */
export function detectMeasuredRunner(command: string): MeasuredRunner | null {
  if (/^bun test\b/.test(command)) return 'bun';
  if (/\bvitest run\b/.test(command)) return 'vitest';
  return null;
}

/** Forward slashes keep the path valid inside a quoted shell argument on Windows too. */
function shellPath(p: string): string {
  return `"${p.replace(/\\/g, '/')}"`;
}

/**
 * Append the reporter flags that write the structured report to `outFile`.
 * The default console reporter stays on, so failure output is unchanged.
 *
 * @param command - Original test command / 元のコマンド
 * @param runner - Detected runner / ランナー
 * @param outFile - Report destination / レポート出力先
 * @returns Command with reporter flags / レポーター付きコマンド
 */
export function withReporter(command: string, runner: MeasuredRunner, outFile: string): string {
  return runner === 'bun'
    ? `${command} --reporter=junit --reporter-outfile=${shellPath(outFile)}`
    : `${command} --reporter=default --reporter=json --outputFile.json=${shellPath(outFile)}`;
}

function isCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

function attr(tag: string, name: string): number | undefined {
  const m = tag.match(new RegExp(`\\s${name}="(\\d+)"`));
  return m ? Number(m[1]) : undefined;
}

type Report = { passed: number; files: string[] };

/** 完結した Vitest の集計を各ファイルのケース結果と照合する。 */
function vitestReport(raw: string): Report | undefined {
  const json = JSON.parse(raw);
  const keys = ['numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests'] as const;
  if (!json || !isCount(json.numTotalTests) || !keys.every((key) => isCount(json[key]))) return;
  if (keys.reduce((sum, key) => sum + json[key], 0) !== json.numTotalTests) return;
  if (!Array.isArray(json.testResults) || json.numPassedTests + json.numFailedTests === 0) return;
  const counts = { passed: 0, failed: 0, pending: 0, todo: 0 };
  const files: string[] = [];
  for (const result of json.testResults) {
    if (!result || typeof result.name !== 'string' || !Array.isArray(result.assertionResults))
      return;
    if (
      !['passed', 'failed'].includes(result.status) ||
      !Number.isFinite(result.endTime) ||
      result.endTime <= 0
    )
      return;
    for (const assertion of result.assertionResults) {
      const status = assertion?.status === 'skipped' ? 'pending' : assertion?.status;
      // NOTE: Object.hasOwn needs lib es2022; this package targets an older lib.
      if (!Object.prototype.hasOwnProperty.call(counts, status)) return;
      counts[status as keyof typeof counts]++;
    }
    if (result.assertionResults.length > 0) files.push(result.name);
  }
  if (Object.values(counts).some((count, i) => count !== json[keys[i]])) return;
  return { passed: json.numPassedTests, files };
}

/** Bun のルート集計を完結した testcase 群と照合し、対象ファイルを返す。 */
function bunReport(raw: string): Report | undefined {
  const xml = raw.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g, '');
  const root = xml.match(
    /^\s*(?:<\?xml[^?]*\?>\s*)?(<testsuites\b[^>]*>)[\s\S]*<\/testsuites>\s*$/,
  )?.[1];
  if (!root) return;
  const stack: string[] = [];
  for (const tag of xml.matchAll(/<(\/?)([\w-]+)\b[^>]*>/g)) {
    if (tag[1]) {
      if (stack.pop() !== tag[2]) return;
    } else if (!tag[0].endsWith('/>')) stack.push(tag[2]);
  }
  if (stack.length) return;
  const tests = attr(root, 'tests');
  const failures = attr(root, 'failures');
  const errors = attr(root, 'errors') ?? 0;
  const skipped = attr(root, 'skipped');
  if (!isCount(tests) || !isCount(failures) || !isCount(errors) || !isCount(skipped)) return;
  const passed = tests - failures - errors - skipped;
  if (!isCount(passed) || tests - skipped <= 0) return;
  const cases = [...xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)];
  if (cases.length !== tests) return;
  if (
    cases.filter((c) => /<failure\b/.test(c[2] ?? '')).length !== failures ||
    cases.filter((c) => /<error\b/.test(c[2] ?? '')).length !== errors ||
    cases.filter((c) => /<skipped\b/.test(c[2] ?? '')).length !== skipped
  )
    return;
  const files = cases.map((c) => c[1].match(/\bfile="([^"]+)"/)?.[1]);
  if (files.some((file) => !file)) return;
  return {
    passed,
    files: (files as string[]).map((file) =>
      file.replace(
        /&(amp|quot|apos|lt|gt);/g,
        (_, entity: string) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[entity]!,
      ),
    ),
  };
}

function readReport(runner: MeasuredRunner, raw: string): Report | undefined {
  try {
    return runner === 'bun' ? bunReport(raw) : vitestReport(raw);
  } catch {
    return undefined;
  }
}

/**
 * Count passed test cases from a completed report.
 * Bun: root `<testsuites>` tests - failures - errors - skipped.
 * Vitest: `numPassedTests` of a finished run. Returns undefined for anything
 * incomplete, malformed or without executed cases (never a guessed number).
 *
 * @param runner - Runner that wrote the report / レポートを書いたランナー
 * @param raw - Report file content / レポート本文
 * @returns Passed case count, or undefined when not trustworthy / 通過ケース数。信頼できなければ undefined
 */
export function parsePassedCount(runner: MeasuredRunner, raw: string): number | undefined {
  return readReport(runner, raw)?.passed;
}

/**
 * Run a test command and measure its passed-case count. The report lives in a
 * per-run temp dir that is removed in `finally`, so concurrent runs never read
 * each other's output; a killed process can leave the OS temp dir behind only.
 *
 * @param command - Scoped test command / コマンド
 * @param cwd - Working directory / 実行ディレクトリ
 * @param timeoutMs - Timeout / タイムアウト
 * @param run - The verifier's command runner / コマンド実行器
 * @returns Raw result plus the count (undefined when not measurable) / 実行結果と通過件数
 */
export async function runMeasuredTest(
  command: string,
  cwd: string,
  timeoutMs: number,
  run: RunCmd,
): Promise<{ res: MeasuredCmdResult; passedCount?: number }> {
  const runner = detectMeasuredRunner(command);
  if (!runner) return { res: await run(command, cwd, timeoutMs) };
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'rapitas-verify-test-'));
  } catch {
    return { res: await run(command, cwd, timeoutMs) }; // cannot measure; still run the gate
  }
  try {
    const outFile = join(dir, runner === 'bun' ? 'report.xml' : 'report.json');
    const res = await run(withReporter(command, runner, outFile), cwd, timeoutMs);
    if (res.code === 124) return { res }; // timed out: the report is incomplete
    try {
      const report = readReport(runner, readFileSync(outFile, 'utf8'));
      const args =
        command.replace(/^.*?(?:bun test|vitest run)\b/, '').match(/"[^"]*"|[^\s]+/g) ?? [];
      const selected = args
        .filter((arg) => arg !== '--isolate')
        .map((arg) => arg.replace(/^"|"$/g, ''));
      const canonical = (file: string) => resolve(cwd, file.replace(/\\/g, '/'));
      const files = new Set(report?.files.map(canonical));
      const complete = selected.length > 0 && selected.every((file) => files.has(canonical(file)));
      return { res, passedCount: complete ? report?.passed : undefined };
    } catch {
      return { res };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Sum passed counts of the parts that ran; undefined unless EVERY ran part has one.
 *
 * @param parts - Per-project checks / プロジェクトごとのチェック
 * @returns Total, or undefined when any ran part is unmeasured / 合計。欠測があれば undefined
 */
export function sumPassedCounts(
  parts: Array<{ ran: boolean; passedCount?: number }>,
): number | undefined {
  const ran = parts.filter((p) => p.ran);
  if (ran.length === 0 || ran.some((p) => !isCount(p.passedCount))) return undefined;
  const total = ran.reduce((s, p) => s + (p.passedCount as number), 0);
  return isCount(total) ? total : undefined;
}

/**
 * Run scoped test commands in order, measuring each; the total is undefined as soon as one is unmeasured.
 *
 * @param commands - Scoped test commands / コマンド群
 * @param cwd - Working directory / 実行ディレクトリ
 * @param timeoutMs - Per-command timeout / コマンドごとのタイムアウト
 * @param run - The verifier's command runner / コマンド実行器
 * @returns Per-command runs (same order) and the summed passed count / 結果と通過件数の合計
 */
export async function runMeasuredTests(
  commands: string[],
  cwd: string,
  timeoutMs: number,
  run: RunCmd,
): Promise<{ runs: Array<{ command: string; res: MeasuredCmdResult }>; passedCount?: number }> {
  const runs: Array<{ command: string; res: MeasuredCmdResult }> = [];
  let passedCount: number | undefined = commands.length ? 0 : undefined;
  for (const command of commands) {
    const m = await runMeasuredTest(command, cwd, timeoutMs, run);
    runs.push({ command, res: m.res });
    passedCount =
      passedCount === undefined || m.passedCount === undefined
        ? undefined
        : passedCount + m.passedCount;
    if (!isCount(passedCount)) passedCount = undefined;
  }
  return { runs, passedCount };
}
