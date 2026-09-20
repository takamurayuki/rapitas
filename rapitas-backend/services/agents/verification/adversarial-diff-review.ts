import { parseAcceptanceCriteria } from './review-acceptance-criteria';
/**
 * Adversarial Diff Review — jury edition
 *
 * INDEPENDENT adversarial judging of the agent's FINAL diff — distinct from the
 * implementer's self-reported verify.md (which can hallucinate success). Up to
 * three judges from DIFFERENT provider families each score the actual code
 * change against plan.md + acceptance criteria; the verdict is the MAJORITY
 * vote (tie breaks to fail — skeptical default). On FAIL the caller bounces the
 * workflow back to the implementer (self-repair loop).
 *
 * Availability policy is RISK-GATED: when no judge produced a verdict, low-risk
 * work fails open ('unknown' → proceed) but HIGH-RISK work (schema/auth/payment/
 * security per routing-policy) fails CLOSED — an unavailable jury must not wave
 * through dangerous changes. Read-only; runs no git/tools.
 *
 * Research basis (docs/research/autonomous-os-improvement-roadmap.md R1):
 * single LLM judges are near-chance on objective correctness (JudgeBench,
 * arXiv:2410.12784); small heterogeneous juries beat a single frontier judge at
 * a fraction of the cost (PoLL, arXiv:2404.18796); independent votes beat
 * debate/devil's-advocate protocols (arXiv:2508.17536). Per-juror verdicts are
 * recorded to the timeline so future weighting can calibrate each judge against
 * realized task outcomes (Weaver, arXiv:2506.18203).
 */
import { getDiff } from '../orchestrator/git-operations/core/diff-structured';
import { getAuxAiMode, sendAIMessage } from '../../../utils/ai-client';
import type { AIProvider } from '../../../utils/ai-client/types';
import { DEFAULT_MODELS } from '../../../utils/ai-client/types';
import { inferProviderFromModelId } from '../../workflow/role-provider-resolver';
import { readWorkflowFile } from '../../workflow/workflow-file-utils';
import { detectHighRisk } from '../../workflow/risk-detection';
import { appendEvent } from '../../memory/timeline';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { resolvePreferredBaseBranch } from '../../task/task-resolver';
import { mapJurors } from './juror-scheduling';
import { buildDiffReviewPrompt } from './adversarial-diff-review-prompt';
import {
  parseReviewVerdict,
  aggregateJuryVerdicts,
  type DiffReviewResult,
  type JurorVerdict,
} from './adversarial-diff-review-verdict';
const log = createLogger('verification:adversarial-diff-review');

/** Max diff characters sent to the judge (keeps token cost bounded). */
// NOTE: 14000 was too small — a ~260-line multi-file diff silently lost its tail
// files, and all jurors unanimously (and wrongly) failed the task as
// "unimplemented" (task 485). Truncation is now explicit per-file with a
// manifest (buildJuryDiffText); this cap only bounds worst-case token cost.
const MAX_DIFF_CHARS = 48000;
/** Minimum patch budget per file so no changed file is entirely invisible. */
const MIN_FILE_PATCH_CHARS = 1500;
/** Providers we will use as a judge, in default preference order. */
const JUDGE_PROVIDERS: AIProvider[] = ['claude', 'gemini', 'chatgpt'];

// NOTE: Prompt text and verdict parsing/aggregation moved to sibling modules
// (file-size split); re-exported so existing importers keep working.
export { buildDiffReviewPrompt } from './adversarial-diff-review-prompt';
export {
  parseReviewVerdict,
  aggregateJuryVerdicts,
  isNonVerdictOnlyFail,
} from './adversarial-diff-review-verdict';
export type {
  ReviewVerdict,
  JurorVerdict,
  DiffReviewResult,
} from './adversarial-diff-review-verdict';

/** One changed file as returned by getDiff (subset used for jury text). */
export interface JuryDiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string | null;
}

/**
 * Build the diff text shown to jurors, with TRUNCATION MADE EXPLICIT.
 *
 * The manifest (every changed file + its +/- stats) is always complete; only
 * patch BODIES are budgeted. When a patch is cut, an explicit [省略] marker is
 * inserted and a banner tells jurors not to treat manifest-listed files as
 * unimplemented — silent tail-truncation previously caused unanimous false
 * FAIL verdicts ("file X missing from diff") on large-but-correct diffs.
 *
 * @param files - Structured diff entries. / 構造化差分
 * @param maxChars - Total character budget. / 全体の文字数上限
 * @returns Jury-facing diff text. / 陪審に渡す差分テキスト
 */
export function buildJuryDiffText(files: JuryDiffFile[], maxChars = MAX_DIFF_CHARS): string {
  if (files.length === 0) return '';
  const manifest = files
    .map((f) => `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`)
    .join('\n');
  const header = `### 変更ファイル一覧（全${files.length}件 — この一覧は省略なしの完全なもの）\n${manifest}\n\n### 差分本文\n`;

  let remaining = Math.max(0, maxChars - header.length);
  const parts: string[] = [];
  let truncated = false;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const head = `--- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})\n`;
    const patch = f.patch ?? '';
    // Fair share of what's left, but never starve a file below the floor —
    // every file must be at least partially visible to the jury.
    const budget = Math.max(MIN_FILE_PATCH_CHARS, Math.floor(remaining / (files.length - i)));
    let body = patch;
    if (patch.length > budget) {
      body = `${patch.slice(0, budget)}\n…[省略: このファイルの差分は文字数制限で途中までしか表示されていません]`;
      truncated = true;
    }
    parts.push(head + body);
    remaining = Math.max(0, remaining - (head.length + body.length));
  }

  const banner = truncated
    ? '⚠️ 注意: 差分本文は長さ制限により一部省略されています（[省略]マーカー参照）。冒頭の「変更ファイル一覧」は完全です。一覧に載っているファイルの変更が差分本文に見えないことを根拠に「未実装」と判定しないでください。省略部分は一覧の+/-統計と表示されている範囲から判断してください。\n\n'
    : '';
  return banner + header + parts.join('\n\n');
}

/** Whether the adversarial review is enabled (default ON; set 0/false to skip). */
export function isAdversarialReviewEnabled(): boolean {
  const v = (process.env.RAPITAS_ADVERSARIAL_REVIEW || '').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
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
 * Wall-clock cap for a single juror.
 *
 * NOTE: This whole review runs SYNCHRONOUSLY inside the agent's
 * `PUT /workflow/tasks/:id/files/verify` request, and `sendAIMessage` has no
 * deadline of its own — one wedged provider held the request open indefinitely.
 * The saving agent's Bash tool gives up on its curl at 120s, backgrounds it and
 * then blocks waiting for output, so wall time past that point is pure idle.
 * The sibling phase-critic gate already caps itself for exactly this reason
 * (critic-gate.ts, task 492).
 *
 * Deliberately does NOT change any verdict semantics: a juror that times out
 * reports 'unknown', which is the same state it reaches today when it errors,
 * so the high-risk fail-closed policy below still applies unchanged.
 */
function jurorTimeoutMs(): number {
  const v = parseInt(process.env.RAPITAS_ADVERSARIAL_JUROR_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 120_000;
}

/** Consecutive timeouts before a juror is rested. */
export const JUROR_TIMEOUT_STRIKES = 3;

/** How long a rested juror is skipped before being tried again. */
export const JUROR_COOLOFF_MS = 30 * 60_000;

/**
 * Per-provider timeout history, in memory on purpose.
 *
 * Jurors run under `Promise.all`, so the review waits for the SLOWEST one: a
 * provider that always times out adds the full timeout to every single review.
 * On 2026-08-28 all 29 adversarial log lines were timeouts, 26 of them the same
 * provider — roughly an hour of added latency for verdicts that were 'unknown'
 * before they were asked. Resting it costs nothing: a skipped juror returns the
 * same 'unknown' it would have returned, just immediately.
 */
const jurorHealth = new Map<AIProvider, { strikes: number; skipUntilMs: number }>();

/** Clear the juror timeout history. Test-only — never call from production code. */
export function resetJurorHealth(): void {
  jurorHealth.clear();
}

/**
 * Whether a juror is currently rested after repeated timeouts.
 *
 * @param provider - Judge provider. / ジャッジのプロバイダ
 * @param nowMs - Current time (ms). / 現在時刻
 * @returns true while the juror should be skipped. / 休ませる間は true
 */
export function jurorIsRested(provider: AIProvider, nowMs: number): boolean {
  return (jurorHealth.get(provider)?.skipUntilMs ?? 0) > nowMs;
}

/**
 * Record one juror attempt so repeated timeouts eventually rest the provider.
 *
 * @param provider - Judge provider. / ジャッジのプロバイダ
 * @param timedOut - Whether this attempt timed out. / タイムアウトしたか
 * @param nowMs - Current time (ms). / 現在時刻
 */
export function recordJurorOutcome(provider: AIProvider, timedOut: boolean, nowMs: number): void {
  if (!timedOut) {
    jurorHealth.delete(provider);
    return;
  }
  const prev = jurorHealth.get(provider);
  const strikes = (prev?.strikes ?? 0) + 1;
  jurorHealth.set(provider, {
    strikes,
    skipUntilMs: strikes >= JUROR_TIMEOUT_STRIKES ? nowMs + JUROR_COOLOFF_MS : 0,
  });
}

/**
 * Ask one juror (provider) for an independent verdict. Never throws.
 *
 * @param provider - Judge provider. / ジャッジのプロバイダ
 * @param prompt - Shared review prompt. / 共通レビュープロンプト
 * @returns The juror's verdict ('unknown' on error/timeout/unparseable). / 判定
 */
async function askJuror(provider: AIProvider, prompt: string): Promise<JurorVerdict> {
  const unknown: JurorVerdict = { provider, verdict: 'unknown', severity: 0, reasons: [] };
  // CLI auxiliary mode routes every family through Claude. Never count those
  // duplicate calls as independent Gemini/OpenAI votes, or wait for them.
  if (getAuxAiMode() === 'cli' && provider !== 'claude') {
    return {
      ...unknown,
      reasons: ['Requested provider unavailable in Claude-only auxiliary CLI mode'],
    };
  }

  const timeoutMs = jurorTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const verdict = await Promise.race([
      sendAIMessage({
        provider,
        model: DEFAULT_MODELS[provider],
        systemPrompt: 'You are a meticulous, skeptical senior code reviewer.',
        maxTokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }).then((res) => {
        const v = parseReviewVerdict(res.content);
        recordJurorOutcome(provider, false, Date.now());
        return { provider, verdict: v.verdict, severity: v.severity, reasons: v.reasons };
      }),
      new Promise<JurorVerdict>((resolve) => {
        timer = setTimeout(() => {
          recordJurorOutcome(provider, true, Date.now());
          log.warn(
            { provider, timeoutMs },
            '[adversarial-review] Juror timed out — counting as unknown',
          );
          resolve(unknown);
        }, timeoutMs);
      }),
    ]);
    return verdict;
  } catch (err) {
    log.warn({ err, provider }, '[adversarial-review] Juror failed');
    return unknown;
  } finally {
    // Without this the pending timer keeps the event loop (and in tests, the
    // process) alive for the full timeout after a fast juror already answered.
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run the adversarial diff review for a task with a cross-provider jury.
 *
 * Availability: 'unknown' when disabled or no diff. When ALL jurors are
 * unavailable, low-risk work fails open ('unknown') but high-risk work
 * (routing-policy detectHighRisk) fails CLOSED with a synthetic 'fail'.
 *
 * @param params.taskId - Task under review. / 対象タスク
 * @param params.worktreePath - The task's git worktree (diff source). / worktree
 * @param params.suppressEventLog - Skip the `adversarial_review` timeline write (dry-run callers record their own `dry_run_executed` event instead, keeping judge-calibration data free of non-production verdicts). / タイムライン記録を抑止する（ドライラン専用）
 * @returns The aggregated jury verdict. / 陪審の集計判定
 */
export async function reviewDiffAdversarially(params: {
  taskId: number;
  worktreePath: string | null | undefined;
  suppressEventLog?: boolean;
}): Promise<DiffReviewResult> {
  const { taskId, worktreePath, suppressEventLog } = params;
  if (!isAdversarialReviewEnabled() || !worktreePath) {
    return { verdict: 'unknown', severity: 0, reasons: [], judged: false };
  }

  try {
    // The worktree's ACTUAL fork point, not a guess — resolveBaseRef otherwise
    // tries develop→main→master and takes the first that resolves, which can
    // land on a stale/divergent branch in the target repo (not rapitas itself)
    // and pull in every commit merged into the real base since, misreading
    // pre-existing unrelated features as this task's own scope creep.
    // NOTE: theme.defaultBranch, not AgentExecutionConfig.targetBranch (task
    // 511: that table is only ever populated by the manual settings route and
    // is empty for the entire autonomous pipeline) — resolvePreferredBaseBranch
    // falls back to it only when the theme itself has no default branch set.
    const preferredBaseBranch = await resolvePreferredBaseBranch(taskId);
    const diff = await getDiff(worktreePath, undefined, preferredBaseBranch ?? undefined);
    const diffText = buildJuryDiffText(diff);
    if (!diffText.trim()) {
      // No code change to review — the completion gate already governs no-op.
      return { verdict: 'unknown', severity: 0, reasons: [], judged: false };
    }

    const planContent = (await readWorkflowFile(taskId, 'plan')) ?? '';
    const task = await prisma.task
      .findUnique({
        where: { id: taskId },
        select: { title: true, description: true, acceptanceCriteria: true },
      })
      .catch(() => null);
    const acceptanceCriteria = parseAcceptanceCriteria(task?.acceptanceCriteria);

    const prompt = buildDiffReviewPrompt({
      taskTitle: task?.title ?? `task-${taskId}`,
      planContent,
      acceptanceCriteria,
      diffText,
    });

    // Jury: every provider judges INDEPENDENTLY and in parallel (no debate —
    // independent votes measurably beat argumentative protocols). Ordering
    // still lists non-implementer families first for log readability only.
    const implProvider = await implementerAIProvider(taskId);
    const order = [
      ...JUDGE_PROVIDERS.filter((p) => p !== implProvider),
      ...JUDGE_PROVIDERS.filter((p) => p === implProvider),
    ];
    // Skip jurors resting after repeated timeouts — they would only add the
    // full timeout to this review and answer 'unknown' anyway. If that would
    // empty the panel, ask everyone: a blind gate is worse than a slow one.
    const nowMs = Date.now();
    const awake = order.filter((p) => !jurorIsRested(p, nowMs));
    const panel = awake.length > 0 ? awake : order;
    if (panel.length < order.length) {
      log.info(
        { rested: order.filter((p) => !panel.includes(p)) },
        '[adversarial-review] Skipping jurors that keep timing out',
      );
    }
    const jurors = await mapJurors(panel, (provider) => askJuror(provider, prompt));
    const aggregated = aggregateJuryVerdicts(jurors);

    // Durable per-juror record for judge-reliability calibration; skipped for
    // dry runs (suppressEventLog) — a dry-run verdict isn't a realized outcome.
    if (!suppressEventLog) {
      void appendEvent({
        eventType: 'adversarial_review',
        actorType: 'system',
        payload: {
          taskId,
          verdict: aggregated.verdict,
          severity: aggregated.severity,
          jurors: jurors.map((j) => ({
            provider: j.provider,
            verdict: j.verdict,
            severity: j.severity,
            reasons: j.reasons,
          })),
        },
        correlationId: `task-${taskId}`,
      }).catch(() => {});
    }

    if (aggregated.verdict !== 'unknown') {
      log.info(
        {
          taskId,
          verdict: aggregated.verdict,
          severity: aggregated.severity,
          votes: jurors.map((j) => `${j.provider}:${j.verdict}`).join(','),
        },
        '[adversarial-review] Jury verdict',
      );
      return aggregated;
    }

    // No juror produced a verdict — risk-gated availability policy.
    const risk = detectHighRisk({
      text: `${task?.title ?? ''}\n${task?.description ?? ''}`,
      planContent,
    });
    if (risk.high) {
      log.warn(
        { taskId, riskReason: risk.reason },
        '[adversarial-review] Jury unavailable on HIGH-RISK change — failing closed',
      );
      return {
        verdict: 'fail',
        severity: 70,
        reasons: [
          '差分レビューのジャッジが利用できませんでした。高リスク変更（スキーマ/認証/決済/セキュリティ）のため安全側でブロックします。ジャッジ復旧後に再検証してください。',
        ],
        judged: false,
        jurors,
      };
    }
    log.warn({ taskId }, '[adversarial-review] Jury unavailable on low-risk change — failing open');
    return { verdict: 'unknown', severity: 0, reasons: [], judged: false, jurors };
  } catch (err) {
    log.warn({ err, taskId }, '[adversarial-review] Review errored — failing open');
    return { verdict: 'unknown', severity: 0, reasons: [], judged: false };
  }
}
