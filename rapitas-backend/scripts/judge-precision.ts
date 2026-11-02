/**
 * Adversarial Judge Precision Probe (opt-in, live model calls)
 *
 * Measures the only gate in this repository whose verdict a model decides.
 * The other thirteen checks in `automated-verifier` are deterministic; this
 * one has been scored against hand-written fixtures (`eval-judge.ts`) but
 * never against the repository's own diffs, and never for self-consistency.
 *
 * What the recorded reviews already show, and why this exists, is in
 * docs/adr/0008-jury-of-claude-models.md.
 *
 * Method. Each case is one surviving task branch of this repository, diffed
 * against its merge base and replayed through the real prompt builder and the
 * real reply parser, in two arms:
 *
 *   clean    the branch's own diff — it passed this gate and the
 *            deterministic checks, so a FAIL here is the judge contradicting
 *            itself.
 *   ablated  the same diff with the largest implementing file removed — a
 *            plan item now genuinely missing, so a PASS here is a miss.
 *
 * Both arms are reported. One alone cannot distinguish an accurate judge from
 * a lenient or a harsh one, and a gate that has never been shown to fail is
 * not known to measure anything (docs/lessons/gates-that-do-not-measure.md).
 *
 * Two caveats, stated plainly. The clean arm is drawn from diffs this judge
 * already passed, so its false-fail rate is a FLOOR, not an estimate. And case
 * supply — not cost — is the binding constraint: most live tasks belong to
 * generated projects in other repositories, and finished rapitas branches are
 * collected, so on 2026-10-21 this repository yielded two replayable cases.
 * Treat a small run as an existence check on the instrument and read the rate
 * off the recorded reviews.
 *
 * Run: `RAPITAS_EVAL_JUDGE_PRECISION=1 bun run scripts/judge-precision.ts`
 *   --cases N      task branches to sample (default 6)
 *   --base REF     branch the diffs are taken against (default origin/develop)
 *   --repeats K    judge calls per case per arm per model (default 2)
 *   --models a,b   model ids, mapped to CLI aliases (default the gate's own)
 *   --out FILE     write the full report as JSON
 */
import { writeFileSync } from 'fs';
import { buildJuryDiffText } from '../services/agents/verification/adversarial-diff-review';
import { buildDiffReviewPrompt } from '../services/agents/verification/adversarial-diff-review-prompt';
import { parseReviewVerdict } from '../services/agents/verification/adversarial-diff-review-verdict';
import { sendAIMessage } from '../utils/ai-client';
import { DEFAULT_MODELS } from '../utils/ai-client/types';
import { collectCases, type ProbeCase } from './judge-precision-cases';
import {
  ablateStructuredDiff,
  scoreArm,
  type Arm,
  type CaseRuns,
  type DiffFile,
  type JudgeRun,
} from './judge-precision-scoring';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Ask one juror once, through the gate's own prompt and parser. */
async function askOnce(
  model: string,
  probe: ProbeCase,
  files: DiffFile[],
  removed: string | null,
): Promise<JudgeRun> {
  const prompt = buildDiffReviewPrompt({
    taskTitle: probe.title,
    planContent: probe.plan,
    acceptanceCriteria: probe.acceptanceCriteria,
    diffText: buildJuryDiffText(files),
  });
  try {
    const res = await sendAIMessage({
      provider: 'claude',
      model,
      systemPrompt: 'You are a meticulous, skeptical senior code reviewer.',
      maxTokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = parseReviewVerdict(res.content);
    const base = removed?.split('/').pop() ?? '';
    const cited =
      parsed.verdict === 'fail' &&
      !!base &&
      parsed.reasons.some((r) => r.includes(base) || (removed ? r.includes(removed) : false));
    return { verdict: parsed.verdict, citedRemoved: cited };
  } catch {
    return { verdict: 'unknown', citedRemoved: false };
  }
}

/**
 * Prove the scorer can tell the arms apart before any model is called.
 *
 * A harness that reports zero wrong verdicts is either measuring a perfect
 * judge or measuring nothing, and only this distinguishes the two.
 */
function selfCheck(): void {
  const allPass: CaseRuns[] = [
    { caseId: 'a', runs: [{ verdict: 'pass', citedRemoved: false }] },
    { caseId: 'b', runs: [{ verdict: 'pass', citedRemoved: false }] },
  ];
  const clean = scoreArm('clean', allPass);
  const ablated = scoreArm('ablated', allPass);
  if (clean.wrongRate !== 0 || ablated.wrongRate !== 1) {
    throw new Error(
      `self-check failed: a judge that always passes must score 0 wrong on clean and 1 on ablated, got ${clean.wrongRate}/${ablated.wrongRate}`,
    );
  }
  const { removed } = ablateStructuredDiff([
    { filename: 'src/impl.ts', status: 'added', additions: 30, deletions: 0 },
    { filename: 'src/impl.test.ts', status: 'added', additions: 40, deletions: 0 },
  ]);
  if (removed !== 'src/impl.ts') {
    throw new Error(`self-check failed: ablation picked ${removed} instead of the implementation`);
  }
}

async function main(): Promise<void> {
  selfCheck();
  if (!process.env.RAPITAS_EVAL_JUDGE_PRECISION) {
    console.log(
      'judge-precision: skipped (set RAPITAS_EVAL_JUDGE_PRECISION=1 — this makes live model calls)',
    );
    return;
  }
  const wantCases = parseInt(arg('cases', '6'), 10);
  const repeats = parseInt(arg('repeats', '2'), 10);
  const models = arg('models', DEFAULT_MODELS.claude)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  const cases = await collectCases(wantCases, arg('base', 'origin/develop'));
  console.log(`cases=${cases.length} repeats=${repeats} models=${models.join(',')}`);
  if (cases.length === 0) {
    console.log('no replayable task branch found — nothing measured');
    process.exitCode = 1;
    return;
  }

  const runs: Record<string, Record<Arm, CaseRuns[]>> = {};
  const detail: Array<Record<string, unknown>> = [];
  for (const model of models) {
    runs[model] = { clean: [], ablated: [] };
    for (const probe of cases) {
      const ablation = ablateStructuredDiff(probe.files);
      for (const arm of ['clean', 'ablated'] as Arm[]) {
        if (arm === 'ablated' && !ablation.removed) continue;
        const files = arm === 'clean' ? probe.files : ablation.files;
        const removed = arm === 'clean' ? null : ablation.removed;
        const got: JudgeRun[] = [];
        for (let k = 0; k < repeats; k++) {
          const r = await askOnce(model, probe, files, removed);
          got.push(r);
          console.log(
            `  ${model} ${probe.caseId} ${arm} #${k + 1}: ${r.verdict}${r.citedRemoved ? ' (named the gap)' : ''}`,
          );
        }
        runs[model][arm].push({ caseId: probe.caseId, runs: got });
        detail.push({
          model,
          arm,
          caseId: probe.caseId,
          taskId: probe.taskId,
          removed,
          verdicts: got.map((g) => g.verdict),
        });
      }
    }
  }

  const report = {
    at: new Date().toISOString(),
    cases: cases.map((c) => ({ caseId: c.caseId, taskId: c.taskId, files: c.files.length })),
    repeats,
    arms: Object.fromEntries(
      models.map((m) => [
        m,
        { clean: scoreArm('clean', runs[m].clean), ablated: scoreArm('ablated', runs[m].ablated) },
      ]),
    ),
    detail,
  };

  console.log('');
  for (const model of models) {
    for (const arm of ['clean', 'ablated'] as Arm[]) {
      const r = report.arms[model][arm];
      const label = arm === 'clean' ? 'false fail' : 'miss';
      console.log(
        `${model} ${arm.padEnd(7)} judged=${r.judgedRuns} unknown=${r.unknownRuns} ` +
          `${label}=${(r.wrongRate * 100).toFixed(1)}% ` +
          `CI ${(r.wrongRateCI[0] * 100).toFixed(1)}-${(r.wrongRateCI[1] * 100).toFixed(1)}% ` +
          `inconsistent=${r.inconsistentCases}/${r.repeatedCases}` +
          (arm === 'ablated' ? ` namedTheGap=${r.citedRemovedRuns}` : ''),
      );
    }
  }

  const out = arg('out', '');
  if (out) {
    writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nwrote ${out}`);
  }
}

await main();
