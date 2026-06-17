/**
 * Gate Evaluation Harness
 *
 * Measures the accuracy of the workflow QUALITY/SAFETY gates against a curated
 * golden set, per the "you can't improve what you don't measure" practice. These
 * gates are the deterministic backbone of autonomous-task precision:
 *   - log-pollution rejection, phase-output validators, plan-scope, test-coverage,
 *     research no-change verdict, and the adversarial-judge reply parser.
 * Each gate is rule-based/deterministic, so the golden set should score 100%; a
 * miss means a regression. Run: `bun run scripts/eval-gates.ts` (CI-friendly,
 * no DB / no live agents). Extend the cases as new failure modes are found.
 *
 * NOTE: This evaluates the gate LOGIC. The LLM judge's end-to-end accuracy needs
 * a labelled diff→verdict set and live calls — out of scope here; we eval its
 * deterministic reply PARSER instead.
 */
import {
  looksLogPolluted,
  validatePlan,
  validateVerify,
  validateResearch,
  isReusableArtifact,
} from '../services/workflow/phase-output-validator';
import { parsePlanFiles, evaluateScopeCheck } from '../services/agents/verification/scope-check';
import { researchConcludesNoChange } from '../services/workflow/completion-gate';
import { parseReviewVerdict } from '../services/agents/verification/adversarial-diff-review';
import { coverageCheck } from '../services/agents/verification/automated-verifier';

process.env.RAPITAS_REQUIRE_TESTS = '1'; // exercise the coverage gate

interface Case {
  name: string;
  /** Returns true when the gate produced the EXPECTED result. */
  ok: () => boolean;
}

const FULL_PLAN = [
  '# 実装計画',
  '## 設計判断の根拠',
  'r',
  '## 実装チェックリスト',
  '- [ ] x',
  '## 変更予定ファイル',
  '- f',
  '## リスク評価',
  'k',
  '## 完了条件',
  'd',
].join('\n');

const GROUPS: { gate: string; cases: Case[] }[] = [
  {
    gate: 'looksLogPolluted',
    cases: [
      { name: 'stream-json', ok: () => looksLogPolluted('# 計画\n{"type":"assistant"}') === true },
      {
        name: 'system marker',
        ok: () => looksLogPolluted('[System: thinking_tokens]\n本文') === true,
      },
      { name: 'clean plan', ok: () => looksLogPolluted(FULL_PLAN) === false },
      { name: 'prose', ok: () => looksLogPolluted('普通の調査メモです。') === false },
    ],
  },
  {
    gate: 'validatePlan / validateVerify / validateResearch',
    cases: [
      { name: 'plan ok', ok: () => validatePlan(FULL_PLAN).ok === true },
      {
        name: 'plan missing rationale',
        ok: () => validatePlan('# 実装計画\n## 完了条件\nd').ok === false,
      },
      {
        name: 'verify polluted',
        ok: () => validateVerify('[Result: completed]\nテスト結果').severity === 100,
      },
      { name: 'research empty', ok: () => validateResearch('').ok === false },
    ],
  },
  {
    gate: 'isReusableArtifact',
    cases: [
      { name: 'reuse valid plan', ok: () => isReusableArtifact('plan', FULL_PLAN) === true },
      {
        name: 'no reuse polluted',
        ok: () => isReusableArtifact('plan', '[System: init]\n#計画') === false,
      },
    ],
  },
  {
    gate: 'parsePlanFiles / evaluateScopeCheck',
    cases: [
      {
        name: 'in-scope (dir + embedded)',
        ok: () => {
          const pf = parsePlanFiles('`services/memory/` と `bun test x/y/z.test.ts`');
          return evaluateScopeCheck(['rapitas-backend/services/memory/a.ts'], pf)?.ok === true;
        },
      },
      {
        name: 'out-of-scope detected',
        ok: () =>
          evaluateScopeCheck(['src/unrelated/x.ts'], ['services/memory/a.ts'])?.ok === false,
      },
      { name: 'prose not a path', ok: () => parsePlanFiles('`foo bar.ts`').length === 0 },
    ],
  },
  {
    gate: 'coverageCheck (RAPITAS_REQUIRE_TESTS=1)',
    cases: [
      { name: 'source w/o test → NG', ok: () => coverageCheck(['services/x.ts'])?.ok === false },
      {
        name: 'source w/ test → ok',
        ok: () => coverageCheck(['services/x.ts', 'tests/x.test.ts'])?.ok === true,
      },
      { name: 'config-only → skip', ok: () => coverageCheck(['x.config.ts']) === null },
    ],
  },
  {
    gate: 'researchConcludesNoChange',
    cases: [
      {
        name: 'verdict',
        ok: () => researchConcludesNoChange('## 結論: 修正不要\n既存で充足') === true,
      },
      {
        name: 'normal research',
        ok: () => researchConcludesNoChange('## 影響範囲\n修正が必要') === false,
      },
    ],
  },
  {
    gate: 'parseReviewVerdict',
    cases: [
      {
        name: 'pass',
        ok: () => parseReviewVerdict('{"verdict":"pass","reasons":[]}').verdict === 'pass',
      },
      {
        name: 'fail in fence',
        ok: () => parseReviewVerdict('```json\n{"verdict":"fail"}\n```').verdict === 'fail',
      },
      {
        name: 'garbage → unknown',
        ok: () => parseReviewVerdict('no json here').verdict === 'unknown',
      },
    ],
  },
];

let total = 0;
let passed = 0;
const failures: string[] = [];
for (const group of GROUPS) {
  let gp = 0;
  for (const c of group.cases) {
    total++;
    let result = false;
    try {
      result = c.ok();
    } catch (err) {
      result = false;
      failures.push(`${group.gate} / ${c.name}: threw ${err instanceof Error ? err.message : err}`);
    }
    if (result) {
      passed++;
      gp++;
    } else if (!failures.some((f) => f.startsWith(`${group.gate} / ${c.name}`))) {
      failures.push(`${group.gate} / ${c.name}: expected behavior not met`);
    }
  }
  const pct = Math.round((gp / group.cases.length) * 100);
  // eslint-disable-next-line no-console
  console.log(`${pct === 100 ? '✅' : '❌'} ${group.gate}: ${gp}/${group.cases.length} (${pct}%)`);
}

// eslint-disable-next-line no-console
console.log(
  `\nGate eval: ${passed}/${total} cases passed (${Math.round((passed / total) * 100)}%)`,
);
if (failures.length > 0) {
  // eslint-disable-next-line no-console
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
