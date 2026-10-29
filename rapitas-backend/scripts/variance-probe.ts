/**
 * variance-probe
 *
 * Asks the same thing several times and measures how much the answers
 * differ — separating the part that comes from the prompt moving from the
 * part the model does on its own.
 *
 * Two arms, same task, same model:
 *
 *   fixed    the identical prompt, N times. Whatever differs here is the
 *            model and the serving stack: sampling, and batch-dependent
 *            reductions that make even temperature 0 non-reproducible on
 *            shared hardware. This is the floor — no amount of harness
 *            work removes it.
 *
 *   varied   the prompt with a retrieved-context block that changes between
 *            runs, the way this harness's own recall did before
 *            workflow-context-snapshot froze it. The distance between this
 *            arm and `fixed` is what the harness is responsible for.
 *
 *   frozen   the same retrieved block on every run — what a task sees once
 *            its context is snapshotted. If freezing works this lands on
 *            `fixed`; if it lands on `varied`, the block was never the
 *            cause and the snapshot is not worth its complexity.
 *
 * The comparison is deterministic: every metric below is computed from the
 * text, with no model in the loop. Run it twice on the same outputs and it
 * returns the same numbers.
 *
 * Usage:
 *   bun run scripts/variance-probe.ts [--runs 5] [--arm fixed|varied|both]
 *   bun run scripts/variance-probe.ts --compare before.json after.json
 *
 * It calls the model directly and writes nothing to the database, so it is
 * safe to run against a live system.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { callClaudeCli } from '../utils/ai-client/claude-cli-provider';

/** The task every run is given. Small, self-contained, and checkable. */
const TASK = `次の React コンポーネントを TypeScript で実装してください。

要件:
- ファイル1つ。export は default ではなく named export で \`TaskCountBadge\`。
- props: { total: number; done: number }
- total が 0 のときは「タスクなし」と表示する。
- それ以外は「<done>/<total> 完了」と表示する。
- done が total と等しいときだけ、ルート要素に className "complete" を足す。
- ルート要素は <span>。

コードだけを返してください。説明文もコードフェンスも不要です。`;

/**
 * Retrieved-context blocks that differ between runs.
 *
 * Deliberately all plausible and all irrelevant to the requirements: the
 * point is to measure what a MOVING context does, not what a wrong one
 * does. This is what the harness's recall looks like from the prompt's
 * side — a few hundred tokens of past lessons that change between phases.
 */
const RECALLED: string[] = [
  '# 過去の知見\n- 以前のタスクで、条件付き className は配列 join より template literal のほうが読みやすいと判断された。\n- 空状態の文言はハードコードで差し支えないという判断が残っている。',
  '# 過去の知見\n- 似たバッジ実装で、props の分割代入を関数シグネチャ側で行う形に統一した経緯がある。\n- 表示件数のフォーマットは「x/y」形式で揃えること。',
  '# 過去の知見\n- 以前 className の付与漏れで差し戻しが発生している。条件は明示的に書くこと。\n- 空状態を null 返却にして表示が消える不具合があった。',
  '# 過去の知見\n- コンポーネントの props 型は interface ではなく type で書く慣習になっている。\n- 文字列結合では不要な空白が入らないよう注意すること。',
  '# 過去の知見\n- 直近の検証で、三項演算子のネストが読みにくいという指摘が複数回出ている。\n- 早期 return を好む方針が記録されている。',
  '# 過去の知見\n- 以前のレビューで、span に role を付けるかどうかは文脈次第と結論が出ている。\n- 数値の 0 を falsy として扱う実装ミスが過去にあった。',
];

type Arm = 'fixed' | 'varied' | 'frozen';

interface Run {
  arm: Arm;
  index: number;
  output: string;
  ms: number;
}

/** Strip what cannot be meaningfully compared: fences, blank lines, indentation. */
function normalise(text: string): string {
  return text
    .replace(/```[a-zA-Z]*\n?/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** Identifiers and keywords, as a set — structure rather than layout. */
function tokens(text: string): Set<string> {
  return new Set(normalise(text).match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Normalised line-level distance: 0 identical, 1 nothing in common. */
function lineDistance(a: string, b: string): number {
  const la = normalise(a).split('\n');
  const lb = normalise(b).split('\n');
  const setB = new Map<string, number>();
  for (const line of lb) setB.set(line, (setB.get(line) ?? 0) + 1);
  let shared = 0;
  for (const line of la) {
    const left = setB.get(line) ?? 0;
    if (left > 0) {
      shared += 1;
      setB.set(line, left - 1);
    }
  }
  const total = Math.max(la.length, lb.length);
  return total === 0 ? 0 : 1 - shared / total;
}

/** Does the output meet the stated requirements? Checked by pattern, not by a model. */
function conforms(text: string): Record<string, boolean> {
  const t = normalise(text);
  return {
    namedExport: /export\s+(const|function)\s+TaskCountBadge|export\s*\{[^}]*TaskCountBadge/.test(
      t,
    ),
    noDefaultExport: !/export\s+default/.test(t),
    emptyState: t.includes('タスクなし'),
    completeClass: t.includes('complete'),
    usesSpan: /<span/.test(t),
    hasProps: /total/.test(t) && /done/.test(t),
  };
}

interface ArmSummary {
  arm: string;
  runs: number;
  /** 90% bootstrap interval for meanLineDistance, resampling RUNS. */
  lineDistanceLow: number;
  lineDistanceHigh: number;
  uniqueOutputs: number;
  exactMatchRate: number;
  meanJaccard: number;
  meanLineDistance: number;
  conformanceRate: number;
  conformanceByRule: Record<string, number>;
  meanMs: number;
}

/**
 * A 90% interval for the mean pairwise distance.
 *
 * Resamples the runs, not the pairs: the n(n-1)/2 distances are not
 * independent — every output appears in n-1 of them — so bootstrapping
 * pairs would report an interval several times too narrow. Measured at
 * n=5 and again at n=8, the same arm moved from 0.467 to 0.283, which is
 * why this interval is printed beside the estimate rather than left out.
 *
 * Deterministic: a fixed seed, so re-running on the same outputs gives
 * the same interval.
 *
 * @param outs - Normalised outputs / 正規化済み出力
 * @returns Low and high bounds / 下限と上限
 */
function bootstrapInterval(outs: string[]): { low: number; high: number } {
  if (outs.length < 3) return { low: 0, high: 1 };
  let seed = 0x5eed;
  const next = () => {
    // xorshift32 — small, fixed, reproducible.
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return Math.abs(seed) / 0x7fffffff;
  };
  const means: number[] = [];
  for (let b = 0; b < 400; b += 1) {
    const sample = Array.from(
      { length: outs.length },
      () => outs[Math.floor(next() * outs.length)],
    );
    let total = 0;
    let pairs = 0;
    for (let i = 0; i < sample.length; i += 1) {
      for (let k = i + 1; k < sample.length; k += 1) {
        total += lineDistance(sample[i], sample[k]);
        pairs += 1;
      }
    }
    if (pairs) means.push(total / pairs);
  }
  means.sort((a, b) => a - b);
  return {
    low: means[Math.floor(0.05 * means.length)] ?? 0,
    high: means[Math.floor(0.95 * means.length)] ?? 1,
  };
}

function summarise(runs: Run[]): ArmSummary {
  const outs = runs.map((r) => normalise(r.output));
  const unique = new Set(outs).size;
  const pairs: { j: number; d: number }[] = [];
  for (let i = 0; i < outs.length; i += 1) {
    for (let k = i + 1; k < outs.length; k += 1) {
      pairs.push({
        j: jaccard(tokens(outs[i]), tokens(outs[k])),
        d: lineDistance(outs[i], outs[k]),
      });
    }
  }
  const checks = outs.map(conforms);
  const ruleNames = Object.keys(checks[0] ?? {});
  const byRule: Record<string, number> = {};
  for (const rule of ruleNames) {
    byRule[rule] = checks.filter((c) => c[rule]).length / Math.max(1, checks.length);
  }
  const interval = bootstrapInterval(outs);
  return {
    arm: runs[0]?.arm ?? '?',
    runs: runs.length,
    lineDistanceLow: interval.low,
    lineDistanceHigh: interval.high,
    uniqueOutputs: unique,
    exactMatchRate: runs.length > 1 ? 1 - (unique - 1) / (runs.length - 1) : 1,
    meanJaccard: pairs.length ? pairs.reduce((s, p) => s + p.j, 0) / pairs.length : 1,
    meanLineDistance: pairs.length ? pairs.reduce((s, p) => s + p.d, 0) / pairs.length : 0,
    conformanceRate:
      checks.length === 0
        ? 0
        : checks.filter((c) => Object.values(c).every(Boolean)).length / checks.length,
    conformanceByRule: byRule,
    meanMs: runs.reduce((s, r) => s + r.ms, 0) / Math.max(1, runs.length),
  };
}

async function ask(prompt: string): Promise<{ output: string; ms: number }> {
  const started = Date.now();
  const response = await callClaudeCli(
    'claude-sonnet-5-5',
    [{ role: 'user', content: prompt }],
    undefined,
    2048,
  );
  return { output: response.content, ms: Date.now() - started };
}

async function runArm(arm: Arm, n: number): Promise<Run[]> {
  const runs: Run[] = [];
  for (let i = 0; i < n; i += 1) {
    // frozen: the first block every time, which is what a snapshotted task
    // sees across its phases and its repair iterations.
    const recalled = arm === 'varied' ? RECALLED[i % RECALLED.length] : RECALLED[0];
    const prompt = arm === 'fixed' ? TASK : `${recalled}\n\n---\n\n${TASK}`;
    const { output, ms } = await ask(prompt);
    runs.push({ arm, index: i, output, ms });
    process.stdout.write(`  ${arm} ${i + 1}/${n} (${(ms / 1000).toFixed(1)}s)\n`);
  }
  return runs;
}

function report(summaries: ArmSummary[]): void {
  console.log(
    '\nRESULT arm            runs unique exact%  jaccard  lineDist   90% interval  conform%',
  );
  for (const s of summaries) {
    console.log(
      `RESULT ${s.arm.padEnd(14)} ${String(s.runs).padStart(4)} ${String(s.uniqueOutputs).padStart(6)} ` +
        `${(100 * s.exactMatchRate).toFixed(0).padStart(6)} ${s.meanJaccard.toFixed(3).padStart(8)} ` +
        `${s.meanLineDistance.toFixed(3).padStart(9)}  ` +
        `${s.lineDistanceLow.toFixed(3)}-${s.lineDistanceHigh.toFixed(3)} ` +
        `${(100 * s.conformanceRate).toFixed(0).padStart(9)}`,
    );
  }
  const fixed = summaries.find((s) => s.arm === 'fixed');
  const varied = summaries.find((s) => s.arm === 'varied');
  const frozen = summaries.find((s) => s.arm === 'frozen');
  if (fixed && varied) {
    const gap = varied.meanLineDistance - fixed.meanLineDistance;
    // Called separated only when the intervals do not overlap. Below that,
    // the difference is not distinguishable from run-to-run noise at this n
    // — measured once at n=5 and once at n=8, this same arm reported 0.467
    // and then 0.283.
    const separated = varied.lineDistanceLow > fixed.lineDistanceHigh;
    console.log(
      `\nRESULT model-only line distance   ${fixed.meanLineDistance.toFixed(3)}` +
        `\nRESULT with a moving context      ${varied.meanLineDistance.toFixed(3)}` +
        `\nRESULT attributable to the prompt ${gap.toFixed(3)}` +
        `  (${separated ? 'intervals separate' : 'INTERVALS OVERLAP — not resolved at this n'})`,
    );
    if (frozen) {
      const moving = varied.meanLineDistance - frozen.meanLineDistance;
      const presence = frozen.meanLineDistance - fixed.meanLineDistance;
      const share = gap === 0 ? 0 : moving / gap;
      console.log(
        `RESULT   the block MOVING          ${moving.toFixed(3)} (${(100 * share).toFixed(0)}% of the gap)` +
          `\nRESULT   the block EXISTING        ${presence.toFixed(3)} (${(100 * (1 - share)).toFixed(0)}% of the gap)`,
      );
    }
  }
  for (const s of summaries) {
    const failed = Object.entries(s.conformanceByRule).filter(([, rate]) => rate < 1);
    if (failed.length) {
      console.log(
        `RESULT ${s.arm} missed: ` +
          failed.map(([r, v]) => `${r} ${(100 * v).toFixed(0)}%`).join(', '),
      );
    }
  }
}

/**
 * Prove the conformance checker can fail before trusting a 100%.
 *
 * A checker that passes everything reports perfect conformance and means
 * nothing — the exact shape of gate this repository has been caught with
 * before (docs/lessons/gates-that-do-not-measure.md).
 */
function selfCheck(): void {
  const good = [
    'export const TaskCountBadge = ({ total, done }: { total: number; done: number }) => {',
    '  if (total === 0) return <span>タスクなし</span>;',
    "  return <span className={done === total ? 'complete' : ''}>{done}/{total} 完了</span>;",
    '};',
  ].join('\n');
  const bad = 'export default function Badge() { return <div>hi</div>; }';
  const g = conforms(good);
  const b = conforms(bad);
  if (!Object.values(g).every(Boolean) || Object.values(b).every(Boolean)) {
    throw new Error(
      `conformance checker is broken: good=${JSON.stringify(g)} bad=${JSON.stringify(b)}`,
    );
  }
  console.log('RESULT conformance checker: accepts a correct answer, rejects a wrong one');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  selfCheck();
  const compareAt = argv.indexOf('--compare');
  if (compareAt !== -1) {
    const [beforePath, afterPath] = argv.slice(compareAt + 1);
    const before = JSON.parse(readFileSync(beforePath, 'utf8')) as ArmSummary[];
    const after = JSON.parse(readFileSync(afterPath, 'utf8')) as ArmSummary[];
    console.log('RESULT arm            before   after    delta  (line distance)');
    for (const b of before) {
      const a = after.find((x) => x.arm === b.arm);
      if (!a) continue;
      console.log(
        `RESULT ${b.arm.padEnd(14)} ${b.meanLineDistance.toFixed(3)}   ${a.meanLineDistance.toFixed(3)}  ` +
          `${(a.meanLineDistance - b.meanLineDistance >= 0 ? '+' : '') + (a.meanLineDistance - b.meanLineDistance).toFixed(3)}`,
      );
    }
    return;
  }

  const runsAt = argv.indexOf('--runs');
  const n = runsAt === -1 ? 5 : Number(argv[runsAt + 1]) || 5;
  const armAt = argv.indexOf('--arm');
  const arm = armAt === -1 ? 'both' : argv[armAt + 1];
  const outAt = argv.indexOf('--out');

  const summaries: ArmSummary[] = [];
  if (arm === 'fixed' || arm === 'both') summaries.push(summarise(await runArm('fixed', n)));
  if (arm === 'varied' || arm === 'both') summaries.push(summarise(await runArm('varied', n)));
  if (arm === 'frozen' || arm === 'both') summaries.push(summarise(await runArm('frozen', n)));
  report(summaries);
  if (outAt !== -1) {
    writeFileSync(argv[outAt + 1], JSON.stringify(summaries, null, 2));
    console.log(`\nwrote ${argv[outAt + 1]}`);
  }
}

await main();
