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
  getDefaultModel,
  isAnyApiKeyConfigured,
  type AIMessage,
} from '../../../utils/ai-client';
// Imported apart from the barrel: tests that replace the barrel with a fixed
// export list must not be broken by this gate's extra dependency.
import { getAuxAiMode } from '../../../utils/ai-client/aux-ai-mode';
import { aggregateCritiques } from './critique-aggregator';
import type { CriticPhase, CriticVerdict, PhaseCritiqueResult } from './phase-critic-types';
import { buildCriticUserMessage, type CriticContext } from './phase-critic.input';

export {
  buildCriticUserMessage,
  truncateWithNotice,
  type CriticContext,
} from './phase-critic.input';

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

/** Build the system prompt for a lens. Exported for tests. */
export function lensSystemPrompt(phase: CriticPhase, lens: Lens): string {
  const artifact = phase === 'research' ? '調査レポート(research.md)' : '実装計画(plan.md)';
  // NOTE: The earlier "甘い合格を出さず、必ず指摘してください" wording forced the
  // LLM to fail nearly every artifact (3 consecutive critiques on task 551, all
  // rejected, each round with brand-new nitpicks) — the gate degenerated into a
  // fixed regenerate-once tax. A critic needs explicit PASS criteria and a
  // convergence rule at least as much as it needs strictness.
  return `あなたは厳格だが公正なレビュアーです。提示された${artifact}を「${lens.angle}」という観点だけで批評してください。
合格基準: ${
    phase === 'research'
      ? 'プランナーが設計を開始できるよう、受入条件ごとの課題・影響範囲・依存関係・リスクが調査されていること。設計の確定や実装手順の完成は求めない。具体的な制御フロー・接続先の関数・停止ガードの採用方法・監査APIの呼出方法は計画フェーズで確定してよい。これらの具体化をプランナーに残しているだけではfailにしない。受入条件そのものの見落とし、事実との矛盾、設計を開始できない重大な未調査だけをfailにする。'
      : '次フェーズの担当者が追加の質問なしに作業へ進める情報が揃っていること。次フェーズが高確率で手戻りする重大な欠落・誤りがある場合のみ pass=false とすること。'
  }
受入条件の充足は見出しや「対応済み」という自己申告ではなく、提案の適用対象・除外条件・実際の動作と照合してください。特定のパス・語句・事例だけを扱う提案が、より広い受入条件を満たすとは限りません。文書が明示的に対象外とした必須ケースは、省略部分に記述があると推測して免除しないでください。
次のものを fail の理由にしてはならない:
- 参考資料（タスク要求・先行フェーズ文書）に既に記載されている情報の${artifact}への再記載要求
- 実装時に自明に決まる細部（ログレベル・ファイル配置・変数名など）の事前確定要求
- 文体・見出し名・体裁など、内容の正しさに影響しない指摘
- 「前回の批評指摘」が提示されている場合: それらが解消済みなら、前回と同等以下の重要度の新規指摘のみを理由とした fail（指摘の後出しで永遠に不合格にしない）
- 本文中に「…[中略: …]」という省略マーカーがある場合、その省略部分の内容が「無い」「途中で切れている」ことを理由にした fail（省略は表示上の制約であり、原文の欠落ではない）${
    phase === 'research'
      ? '\n- research.md（調査）の段階でplan.md（計画）が確定すべき実装詳細（関数シグネチャ・具体的なコード差分・変更前後の行番号・挿入位置の一意な決定）の事前確定要求。research.mdの役割は影響範囲・依存関係・リスクの調査であり、設計の確定はplanフェーズの責務'
      : ''
  }
出力は次のJSONのみ（前後に説明やコードブロックを付けない）:
{"pass":true|false,"severity":0-100,"issues":["具体的な指摘",...]}
- pass=false のとき issues に対応すべき具体的指摘を1件以上。
- severity は問題の深刻度（pass=true なら 0）。`;
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
  if (context?.unavailable) {
    return {
      verdict: 'unknown',
      severity: 0,
      reasons: ['Required critique context could not be loaded'],
      inputTruncated: false,
      evaluationComplete: false,
    };
  }
  if (!content.trim())
    return { verdict: 'unknown', severity: 0, reasons: [], inputTruncated: false };
  // The subscription CLI path needs no API key; gating on one returned
  // `unknown` for every lens whenever the key lived only in the DB (task
  // worktrees, 2026-09-25 #911: the live evaluation scored 0/3 without ever
  // calling the model).
  if (getAuxAiMode() !== 'cli' && !(await isAnyApiKeyConfigured()))
    return { verdict: 'unknown', severity: 0, reasons: [], inputTruncated: false };

  let provider: Awaited<ReturnType<typeof getDefaultProvider>>;
  let model: string;
  try {
    provider = await getDefaultProvider();
    model = await getDefaultModel(provider);
  } catch {
    return { verdict: 'unknown', severity: 0, reasons: [], inputTruncated: false };
  }

  const lenses = LENSES[phase];
  const {
    message: userMessage,
    truncated: inputTruncated,
    requirementsOrArtifactTruncated,
  } = buildCriticUserMessage(content, context);
  const verdicts = await Promise.all(
    lenses.map(async (lens): Promise<CriticVerdict | null> => {
      try {
        const messages: AIMessage[] = [{ role: 'user', content: userMessage }];
        const res = await sendAIMessage({
          provider,
          model,
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

  const aggregated = aggregateCritiques(verdicts.filter((v): v is CriticVerdict => v !== null));
  const evaluationComplete = verdicts.every((v) => v !== null);
  const downgradedByTruncation = requirementsOrArtifactTruncated && aggregated.verdict === 'pass';
  const result: PhaseCritiqueResult = {
    ...aggregated,
    // A partial document cannot establish that the whole artifact passed.
    // NOTE: Only a cut in what is judged or what it is judged against (the
    // artifact, the task brief, the acceptance criteria) counts — a hidden
    // correction there could flip the verdict. A cut earlier-phase document
    // is background: counting it turned every pass on a long research.md into
    // unknown, 6 of 6 plan critiques in 30 days (task 1510). inputTruncated
    // still reports any cut.
    verdict: downgradedByTruncation ? 'unknown' : aggregated.verdict,
    downgradedByTruncation,
    inputTruncated,
    evaluationComplete,
  };
  log.info(
    {
      phase,
      verdict: result.verdict,
      severity: result.severity,
      lenses: lenses.length,
      evaluationComplete,
      inputTruncated,
      downgradedByTruncation,
    },
    '[phase-critic] critique complete',
  );
  return result;
}
