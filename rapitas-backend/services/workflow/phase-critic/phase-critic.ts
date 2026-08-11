/**
 * Phase Critic
 *
 * Brings the judge-panel pattern to the research/plan phases: runs several
 * independent critic "lenses" in parallel over the produced artifact and
 * aggregates their verdicts. Each lens is a lightweight API call (no repo
 * access needed — it critiques the artifact text plus optional grounding
 * context), so this is safe to run within the per-task lock without spawning
 * parallel CLI agents.
 *
 * Generation only — bouncing/rollback lives in phase-critic-gate.ts. Fail-open:
 * when AI is unavailable or every lens errors, the verdict is 'unknown'.
 */
import { createLogger } from '../../../config/logger';
import {
  sendAIMessage,
  getDefaultProvider,
  isAnyApiKeyConfigured,
  type AIMessage,
} from '../../../utils/ai-client';
import { aggregateCritiques } from './critique-aggregator';
import type { CriticPhase, CriticVerdict, PhaseCritiqueResult } from './phase-critic-types';

const log = createLogger('workflow:phase-critic');

/** A single critic lens: a name and the angle it judges from. */
interface Lens {
  name: string;
  angle: string;
}

/** Lenses per phase — kept few to bound cost. */
const LENSES: Record<CriticPhase, Lens[]> = {
  research: [
    { name: 'completeness', angle: '依存関係・影響範囲・変更対象ファイルの特定に漏れがないか' },
    { name: 'risk', angle: '破壊的変更・後方互換・移行・セキュリティのリスク評価が十分か' },
    { name: 'duplication', angle: '既存実装/重複の調査が不足していないか（車輪の再発明リスク）' },
  ],
  plan: [
    { name: 'feasibility', angle: '計画が調査結果と整合し、実装可能で粒度が適切か' },
    { name: 'acceptance', angle: 'タスクの受入基準を計画が確実に満たすか（抜けがないか）' },
    { name: 'scope', angle: 'スコープ過大/過小、リスク対策・テスト戦略の欠落がないか' },
  ],
};

/**
 * Whether the research/plan critic gate is enabled (default ON — R7).
 * Iterative judge-critique of plans detects defects PRE-execution with ~90%
 * recall (arXiv:2509.02761), and a caught plan defect is far cheaper than the
 * implement→verify→bounce loop it would otherwise cause. Set
 * RAPITAS_PHASE_CRITIC=0/false/off to opt out. Callers additionally skip the
 * gate for lightweight-mode tasks (no plan phase; trivial work stays cheap).
 */
export function isPhaseCriticEnabled(): boolean {
  const v = (process.env.RAPITAS_PHASE_CRITIC || '').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/**
 * Optional grounding context handed to every lens. Without it the critic can
 * only judge the artifact text in a vacuum — observed failure mode (task 551):
 * the plan critic demanded restating facts that already lived in research.md,
 * and each re-review invented a fresh batch of demands because it never saw
 * what the previous rejection asked for. All fields are best-effort.
 */
export interface CriticContext {
  /** Task title + description the artifact must serve. / タスク要求 */
  taskBrief?: string;
  /** Prior-phase document the artifact builds on (research.md for plan). / 先行フェーズ文書 */
  referenceArtifact?: string;
  /** Reasons from this phase's previous critic rejection. / 前回の差し戻し理由 */
  priorReasons?: string[];
}

/** Build the system prompt for a lens. */
function lensSystemPrompt(phase: CriticPhase, lens: Lens): string {
  const artifact = phase === 'research' ? '調査レポート(research.md)' : '実装計画(plan.md)';
  // NOTE: The earlier "甘い合格を出さず、必ず指摘してください" wording forced the
  // LLM to fail nearly every artifact (3 consecutive critiques on task 551, all
  // rejected, each round with brand-new nitpicks) — the gate degenerated into a
  // fixed regenerate-once tax. A critic needs explicit PASS criteria and a
  // convergence rule at least as much as it needs strictness.
  return `あなたは厳格だが公正なレビュアーです。提示された${artifact}を「${lens.angle}」という観点だけで批評してください。
合格基準: 次フェーズの担当者が追加の質問なしに作業へ進める情報が揃っていること。次フェーズが高確率で手戻りする重大な欠落・誤りがある場合のみ pass=false とすること。
次のものを fail の理由にしてはならない:
- 参考資料（タスク要求・先行フェーズ文書）に既に記載されている情報の${artifact}への再記載要求
- 実装時に自明に決まる細部（ログレベル・ファイル配置・変数名など）の事前確定要求
- 文体・見出し名・体裁など、内容の正しさに影響しない指摘
- 「前回の批評指摘」が提示されている場合: それらが解消済みなら、前回と同等以下の重要度の新規指摘のみを理由とした fail（指摘の後出しで永遠に不合格にしない）
出力は次のJSONのみ（前後に説明やコードブロックを付けない）:
{"pass":true|false,"severity":0-100,"issues":["具体的な指摘",...]}
- pass=false のとき issues に対応すべき具体的指摘を1件以上。
- severity は問題の深刻度（pass=true なら 0）。`;
}

/**
 * Assemble the user message a lens critiques: grounding sections first (marked
 * as reference material, not critique targets), the artifact last. Pure —
 * exported for tests.
 *
 * @param content - Artifact body. / アーティファクト本文
 * @param context - Optional grounding context. / 参考資料
 * @returns The composed user message. / レンズに渡す本文
 */
export function buildCriticUserMessage(content: string, context?: CriticContext): string {
  const parts: string[] = [];
  if (context?.taskBrief?.trim()) {
    parts.push(`# タスク要求（参考資料 — 批評対象ではない）\n${context.taskBrief.slice(0, 3000)}`);
  }
  if (context?.referenceArtifact?.trim()) {
    parts.push(
      `# 先行フェーズ文書（参考資料 — 批評対象ではない。ここに既にある情報の再記載を要求しないこと）\n${context.referenceArtifact.slice(0, 8000)}`,
    );
  }
  if (context?.priorReasons?.length) {
    const reasons = context.priorReasons
      .slice(0, 8)
      .map((r) => `- ${r}`)
      .join('\n');
    parts.push(`# 前回の批評指摘（この文書は指摘を受けて改訂済み）\n${reasons}`);
  }
  parts.push(`# 批評対象アーティファクト\n${content.slice(0, 16000)}`);
  return parts.join('\n\n');
}

/** Tolerantly parse a lens response. On parse failure, default to pass (no false block). */
export function parseCriticResponse(content: string, lens: string): CriticVerdict {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return { lens, pass: true, severity: 0, issues: [] };
  try {
    const parsed = JSON.parse(match[0]) as {
      pass?: unknown;
      severity?: unknown;
      issues?: unknown;
    };
    const pass = parsed.pass !== false; // anything but explicit false = pass
    const severity =
      typeof parsed.severity === 'number'
        ? Math.max(0, Math.min(100, parsed.severity))
        : pass
          ? 0
          : 50;
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.filter((i): i is string => typeof i === 'string' && i.trim().length > 0)
      : [];
    return { lens, pass, severity, issues };
  } catch {
    return { lens, pass: true, severity: 0, issues: [] };
  }
}

/**
 * Critique a research/plan artifact across all lenses and aggregate the verdict.
 *
 * @param phase - Which artifact is being judged. / 判定対象フェーズ
 * @param content - The artifact's markdown body. / アーティファクト本文
 * @param context - Optional grounding (task brief / prior phase doc / prior reasons). / 参考資料
 * @returns Aggregated verdict ('unknown' when critics could not run). / 集約結果
 */
export async function critiquePhase(
  phase: CriticPhase,
  content: string,
  context?: CriticContext,
): Promise<PhaseCritiqueResult> {
  if (!content.trim()) return { verdict: 'unknown', severity: 0, reasons: [] };
  if (!(await isAnyApiKeyConfigured())) return { verdict: 'unknown', severity: 0, reasons: [] };

  let provider: Awaited<ReturnType<typeof getDefaultProvider>>;
  try {
    provider = await getDefaultProvider();
  } catch {
    return { verdict: 'unknown', severity: 0, reasons: [] };
  }

  const lenses = LENSES[phase];
  const userMessage = buildCriticUserMessage(content, context);
  const verdicts = await Promise.all(
    lenses.map(async (lens): Promise<CriticVerdict | null> => {
      try {
        const messages: AIMessage[] = [{ role: 'user', content: userMessage }];
        const res = await sendAIMessage({
          provider,
          messages,
          systemPrompt: lensSystemPrompt(phase, lens),
          maxTokens: 800,
        });
        return parseCriticResponse(res.content, lens.name);
      } catch (err) {
        log.warn({ err, phase, lens: lens.name }, '[phase-critic] lens failed (skipped)');
        return null;
      }
    }),
  );

  const result = aggregateCritiques(verdicts.filter((v): v is CriticVerdict => v !== null));
  log.info(
    { phase, verdict: result.verdict, severity: result.severity, lenses: lenses.length },
    '[phase-critic] critique complete',
  );
  return result;
}
