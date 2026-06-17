/**
 * Adversarial Diff Review
 *
 * An INDEPENDENT, adversarial judge of the agent's FINAL diff — distinct from the
 * implementer's own self-reported verify.md (which can hallucinate success). A
 * judge model (preferably a different provider than the implementer, to cut
 * self-evaluation bias) scores the actual code change against plan.md + the
 * task's acceptance criteria with a rubric, actively trying to find ways the
 * change is wrong / incomplete / unsafe. On a FAIL verdict the caller bounces the
 * workflow back to the implementer (self-repair loop). Fail-OPEN on infra/parse
 * errors so a broken judge never dead-ends a task. Read-only; runs no git/tools.
 *
 * Latest-practice basis: verifiable checks (lint/type/test/scope) answer "does it
 * work", an LLM rubric judge answers "is it correct/complete/secure", and an
 * adversarial second opinion catches the cases self-verification misses.
 */
import { getDiff } from '../orchestrator/git-operations/diff-structured';
import { sendAIMessage } from '../../../utils/ai-client';
import type { AIProvider } from '../../../utils/ai-client/types';
import { DEFAULT_MODELS } from '../../../utils/ai-client/types';
import { inferProviderFromModelId } from '../../workflow/role-provider-resolver';
import { resolveWorkflowDir, readWorkflowFile } from '../../workflow/workflow-file-utils';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';

const log = createLogger('verification:adversarial-diff-review');

/** Max diff characters sent to the judge (keeps token cost bounded). */
const MAX_DIFF_CHARS = 14000;
/** Providers we will use as a judge, in default preference order. */
const JUDGE_PROVIDERS: AIProvider[] = ['claude', 'gemini', 'chatgpt'];

export type ReviewVerdict = 'pass' | 'fail' | 'unknown';

export interface DiffReviewResult {
  /** 'fail' = the diff does NOT satisfy the task; 'unknown' = judge unavailable. */
  verdict: ReviewVerdict;
  /** 0-100; higher = more serious. Only meaningful for 'fail'. */
  severity: number;
  /** Short human-readable reasons (used as self-repair feedback). */
  reasons: string[];
  /** True when a judge actually evaluated the diff. */
  judged: boolean;
}

/** Whether the adversarial review is enabled (default ON; set 0/false to skip). */
export function isAdversarialReviewEnabled(): boolean {
  const v = (process.env.RAPITAS_ADVERSARIAL_REVIEW || '').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/**
 * Build the judge prompt. Pure and unit-testable.
 *
 * @param p - Task title, plan, acceptance criteria, and the diff text. / 採点入力
 * @returns The prompt body for the judge. / ジャッジ用プロンプト
 */
export function buildDiffReviewPrompt(p: {
  taskTitle: string;
  planContent: string;
  acceptanceCriteria: string[];
  diffText: string;
}): string {
  const ac =
    p.acceptanceCriteria.length > 0
      ? p.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : '(明示的な受入基準なし — 計画の意図を基準にする)';
  return `あなたはシニアコードレビュアーです。下記タスクの「最終差分」が要件を満たすか、**粗探しをする姿勢で**厳しく評価してください。実装者の自己申告は信用せず、差分そのものだけを根拠に判断します。

## タスク
${p.taskTitle}

## 計画 (plan.md)
${p.planContent.slice(0, 6000) || '(計画なし)'}

## 受入基準
${ac}

## 最終差分 (git diff)
\`\`\`diff
${p.diffText}
\`\`\`

## 評価観点（ルーブリック）
- 要件充足: 各受入基準/計画の意図を実際に満たしているか（未実装・部分実装・的外れを検出）
- 正しさ: 明確なバグ・ロジック誤り・エッジケース未処理・型/契約違反
- 安全性: 機密情報の混入、危険な操作、インジェクション等
- 範囲: 計画外の不要・破壊的変更が混ざっていないか

## 出力（厳守）
**JSONオブジェクトのみ**を出力してください（前置き・コードフェンス不要）:
{"verdict":"pass"|"fail","severity":0-100,"reasons":["不合格や懸念の具体的根拠を簡潔に。passなら空配列可"]}
判定基準: 受入基準を満たさない／実装が的外れ・未完／明確なバグ・セキュリティ問題がある場合は "fail"。軽微な好みの問題だけなら "pass"。確信が持てない重大な疑義は "fail" 側に倒す。`;
}

/**
 * Parse the judge's reply into a verdict. Tolerant of code fences / prose around
 * the JSON. Pure and unit-testable. Unknown shape → 'unknown' (fail-open).
 *
 * @param text - The judge's raw reply. / ジャッジの応答
 * @returns Parsed verdict. / 解析結果
 */
export function parseReviewVerdict(text: string | null | undefined): DiffReviewResult {
  const fail = (verdict: ReviewVerdict, severity: number, reasons: string[]): DiffReviewResult => ({
    verdict,
    severity,
    reasons,
    judged: verdict !== 'unknown',
  });
  if (!text || !text.trim()) return fail('unknown', 0, []);

  // Extract the first balanced { ... } object.
  const start = text.indexOf('{');
  if (start === -1) return fail('unknown', 0, []);
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return fail('unknown', 0, []);

  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as {
      verdict?: string;
      severity?: number;
      reasons?: unknown;
    };
    const v = (obj.verdict || '').toLowerCase();
    const verdict: ReviewVerdict = v === 'fail' ? 'fail' : v === 'pass' ? 'pass' : 'unknown';
    const severity =
      typeof obj.severity === 'number'
        ? Math.max(0, Math.min(100, obj.severity))
        : verdict === 'fail'
          ? 80
          : 0;
    const reasons = Array.isArray(obj.reasons)
      ? obj.reasons.filter((r): r is string => typeof r === 'string').slice(0, 10)
      : [];
    return fail(verdict, severity, reasons);
  } catch {
    return fail('unknown', 0, []);
  }
}

/** Map a role-resolver Provider (e.g. 'openai') to an AI-client provider. */
function toAIProvider(p: string | null): AIProvider | null {
  if (p === 'openai') return 'chatgpt';
  if (p === 'claude' || p === 'gemini' || p === 'chatgpt') return p as AIProvider;
  return null; // ollama / unknown → not used as a judge
}

/** Best-effort: the AI provider the implementer used, to exclude it as judge. */
async function implementerAIProvider(taskId: number): Promise<AIProvider | null> {
  const exec = await prisma.agentExecution
    .findFirst({
      where: { session: { config: { taskId } } },
      orderBy: { createdAt: 'desc' },
      select: { modelName: true },
    })
    .catch(() => null);
  return exec?.modelName ? toAIProvider(inferProviderFromModelId(exec.modelName)) : null;
}

/**
 * Run the adversarial diff review for a task. Fail-open: returns 'unknown' when
 * disabled, when there is no diff, or when no judge could be reached.
 *
 * @param params.taskId - Task under review. / 対象タスク
 * @param params.worktreePath - The task's git worktree (diff source). / worktree
 * @returns The judge's verdict. / ジャッジ判定
 */
export async function reviewDiffAdversarially(params: {
  taskId: number;
  worktreePath: string | null | undefined;
}): Promise<DiffReviewResult> {
  const { taskId, worktreePath } = params;
  if (!isAdversarialReviewEnabled() || !worktreePath) {
    return { verdict: 'unknown', severity: 0, reasons: [], judged: false };
  }

  try {
    const diff = await getDiff(worktreePath);
    const diffText = diff
      .map(
        (f) => `--- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})\n${f.patch ?? ''}`,
      )
      .join('\n\n')
      .slice(0, MAX_DIFF_CHARS);
    if (!diffText.trim()) {
      // No code change to review — the completion gate already governs no-op.
      return { verdict: 'unknown', severity: 0, reasons: [], judged: false };
    }

    const resolved = await resolveWorkflowDir(taskId);
    const planContent = resolved ? ((await readWorkflowFile(resolved.dir, 'plan')) ?? '') : '';
    const task = await prisma.task
      .findUnique({ where: { id: taskId }, select: { title: true, acceptanceCriteria: true } })
      .catch(() => null);
    const acceptanceCriteria = parseAcceptanceCriteria(task?.acceptanceCriteria);

    const prompt = buildDiffReviewPrompt({
      taskTitle: task?.title ?? `task-${taskId}`,
      planContent,
      acceptanceCriteria,
      diffText,
    });

    // Prefer a provider different from the implementer's (cross-provider second
    // opinion); fall back through the others. First successful call wins.
    const implProvider = await implementerAIProvider(taskId);
    const order = [
      ...JUDGE_PROVIDERS.filter((p) => p !== implProvider),
      ...JUDGE_PROVIDERS.filter((p) => p === implProvider),
    ];
    for (const provider of order) {
      try {
        const res = await sendAIMessage({
          provider,
          model: DEFAULT_MODELS[provider],
          systemPrompt: 'You are a meticulous, skeptical senior code reviewer.',
          maxTokens: 1200,
          messages: [{ role: 'user', content: prompt }],
        });
        const verdict = parseReviewVerdict(res.content);
        if (verdict.verdict !== 'unknown') {
          log.info(
            { taskId, provider, verdict: verdict.verdict, severity: verdict.severity },
            '[adversarial-review] Diff judged',
          );
          return verdict;
        }
        // Unparseable reply — try the next provider.
      } catch (err) {
        log.warn(
          { err, taskId, provider },
          '[adversarial-review] Judge provider failed — trying next',
        );
      }
    }
    log.warn({ taskId }, '[adversarial-review] No judge produced a verdict — failing open');
    return { verdict: 'unknown', severity: 0, reasons: [], judged: false };
  } catch (err) {
    log.warn({ err, taskId }, '[adversarial-review] Review errored — failing open');
    return { verdict: 'unknown', severity: 0, reasons: [], judged: false };
  }
}

/** Parse the task's acceptanceCriteria JSON-string column into a string[]. */
function parseAcceptanceCriteria(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const p: unknown = JSON.parse(raw);
      return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}
