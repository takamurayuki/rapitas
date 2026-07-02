/**
 * Adversarial Judge Accuracy Eval (opt-in, live LLM calls)
 *
 * Measures the END-TO-END accuracy of the adversarial diff reviewer — does the
 * judge model actually return the RIGHT verdict on a labelled diff→verdict set?
 * Complements `eval:gates`, which only scores the deterministic reply PARSER.
 *
 * Because this makes real API calls (cost + non-determinism), it is OPT-IN:
 * set RAPITAS_EVAL_JUDGE=1 to run; otherwise it prints a skip notice and exits 0
 * (so it never breaks an unconfigured CI). Pick the judge with
 * RAPITAS_EVAL_JUDGE_PROVIDER (claude|gemini|chatgpt, default claude). A run
 * scores below RAPITAS_EVAL_JUDGE_MIN (default 0.8) → non-zero exit.
 *
 * Run: `RAPITAS_EVAL_JUDGE=1 bun run scripts/eval-judge.ts`
 * Extend FIXTURES as the judge surfaces real-world failure modes.
 */
import {
  buildDiffReviewPrompt,
  parseReviewVerdict,
  type ReviewVerdict,
} from '../services/agents/verification/adversarial-diff-review';
import { sendAIMessage } from '../utils/ai-client';
import { DEFAULT_MODELS, type AIProvider } from '../utils/ai-client/types';

interface Fixture {
  name: string;
  expected: Exclude<ReviewVerdict, 'unknown'>;
  taskTitle: string;
  plan: string;
  acceptanceCriteria: string[];
  diff: string;
}

const FIXTURES: Fixture[] = [
  {
    name: 'pass: implements requirement with test',
    expected: 'pass',
    taskTitle: 'slugify ユーティリティを追加',
    plan: '## 実装チェックリスト\n- [ ] slugify(s) を追加\n- [ ] 単体テストを追加',
    acceptanceCriteria: ['空白をハイフンに、英字を小文字化する', 'テストが存在する'],
    diff: `--- src/utils/slugify.ts (added, +6/-0)
+export function slugify(s: string): string {
+  return s.trim().toLowerCase().replace(/\\s+/g, '-');
+}
--- src/utils/slugify.test.ts (added, +4/-0)
+import { slugify } from './slugify';
+test('slugify', () => {
+  expect(slugify('Hello World')).toBe('hello-world');
+});`,
  },
  {
    name: 'fail: only half the plan implemented',
    expected: 'fail',
    taskTitle: 'ログイン時にレート制限とロックアウトを追加',
    plan: '## 実装チェックリスト\n- [ ] レート制限を追加\n- [ ] N回失敗でロックアウト',
    acceptanceCriteria: ['レート制限が効く', '連続失敗でアカウントがロックされる'],
    diff: `--- src/auth/login.ts (modified, +3/-0)
+  if (rateLimiter.tooMany(ip)) {
+    throw new Error('rate limited');
+  }
   // lockout is still not implemented`,
  },
  {
    name: 'fail: off-target stub returns wrong value',
    expected: 'fail',
    taskTitle: '税込価格を計算する calcTotal を実装',
    plan: '## 実装チェックリスト\n- [ ] calcTotal(price, taxRate) を実装',
    acceptanceCriteria: ['price * (1 + taxRate) を返す'],
    diff: `--- src/pricing.ts (added, +3/-0)
+export function calcTotal(price: number, taxRate: number): number {
+  return price; // TODO
+}`,
  },
  {
    name: 'fail: leaks a secret in logs',
    expected: 'fail',
    taskTitle: 'API クライアントのデバッグログを追加',
    plan: '## 実装チェックリスト\n- [ ] リクエスト失敗時にデバッグログを出す',
    acceptanceCriteria: ['失敗時にエンドポイントとステータスをログする'],
    diff: `--- src/api/client.ts (modified, +2/-0)
+  logger.info('request failed', { endpoint, status });
+  logger.info('using api key', { apiKey: process.env.SECRET_API_KEY });`,
  },
  {
    name: 'pass: clean refactor matching plan',
    expected: 'pass',
    taskTitle: 'sum を reduce で書き直す（挙動は不変）',
    plan: '## 実装チェックリスト\n- [ ] for ループを reduce に置き換え（挙動不変）',
    acceptanceCriteria: ['合計値の計算結果が変わらない'],
    diff: `--- src/math.ts (modified, +1/-4)
-export function sum(xs: number[]): number {
-  let t = 0;
-  for (const x of xs) t += x;
-  return t;
-}
+export const sum = (xs: number[]): number => xs.reduce((t, x) => t + x, 0);`,
  },
];

function resolveProvider(): AIProvider {
  const raw = (process.env.RAPITAS_EVAL_JUDGE_PROVIDER || 'claude').trim().toLowerCase();
  if (raw === 'claude' || raw === 'gemini' || raw === 'chatgpt') return raw;
  return 'claude';
}

async function judge(provider: AIProvider, f: Fixture): Promise<ReviewVerdict> {
  const prompt = buildDiffReviewPrompt({
    taskTitle: f.taskTitle,
    planContent: f.plan,
    acceptanceCriteria: f.acceptanceCriteria,
    diffText: f.diff,
  });
  const res = await sendAIMessage({
    provider,
    model: DEFAULT_MODELS[provider],
    systemPrompt: 'You are a meticulous, skeptical senior code reviewer.',
    maxTokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  });
  return parseReviewVerdict(res.content).verdict;
}

async function main(): Promise<void> {
  const enabled = ['1', 'true', 'on'].includes(
    (process.env.RAPITAS_EVAL_JUDGE || '').trim().toLowerCase(),
  );
  if (!enabled) {
    console.log('⏭  Judge eval skipped — set RAPITAS_EVAL_JUDGE=1 to run (makes live LLM calls).');
    return;
  }

  const provider = resolveProvider();
  const minAccuracy = Number(process.env.RAPITAS_EVAL_JUDGE_MIN || '0.8');
  console.log(`Judge eval — provider=${provider}, ${FIXTURES.length} cases, min=${minAccuracy}\n`);

  let correct = 0;
  let errored = 0;
  for (const f of FIXTURES) {
    let got: ReviewVerdict = 'unknown';
    try {
      got = await judge(provider, f);
    } catch (err) {
      errored++;
      console.error(
        `💥 ${f.name}: judge call failed — ${err instanceof Error ? err.message : err}`,
      );
      continue;
    }
    const ok = got === f.expected;
    if (ok) correct++;
    console.log(`${ok ? '✅' : '❌'} ${f.name} → got=${got}, expected=${f.expected}`);
  }

  if (errored === FIXTURES.length) {
    console.error(`\nAll ${errored} cases errored — judge provider "${provider}" unreachable.`);
    process.exit(1);
  }

  const accuracy = correct / FIXTURES.length;
  console.log(
    `\nJudge accuracy: ${correct}/${FIXTURES.length} (${Math.round(accuracy * 100)}%)` +
      (errored ? ` — ${errored} errored` : ''),
  );
  if (accuracy < minAccuracy) {
    console.error(`Below threshold ${Math.round(minAccuracy * 100)}% — failing.`);
    process.exit(1);
  }
}

void main();
