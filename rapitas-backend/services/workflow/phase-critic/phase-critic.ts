/**
 * Phase Critic
 *
 * Brings the judge-panel pattern to the research/plan phases: runs several
 * independent critic "lenses" in parallel over the produced artifact and
 * aggregates their verdicts. Each lens is a lightweight API call (no repo
 * access needed — it critiques the artifact text), so this is safe to run
 * within the per-task lock without spawning parallel CLI agents.
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

/** Build the system prompt for a lens. */
function lensSystemPrompt(phase: CriticPhase, lens: Lens): string {
  const artifact = phase === 'research' ? '調査レポート(research.md)' : '実装計画(plan.md)';
  return `あなたは厳格なレビュアーです。提示された${artifact}を「${lens.angle}」という観点だけで批評してください。
甘い合格を出さず、重大な抜け・誤りがあれば必ず指摘してください。
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
 * @returns Aggregated verdict ('unknown' when critics could not run). / 集約結果
 */
export async function critiquePhase(
  phase: CriticPhase,
  content: string,
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
  const verdicts = await Promise.all(
    lenses.map(async (lens): Promise<CriticVerdict | null> => {
      try {
        const messages: AIMessage[] = [{ role: 'user', content: content.slice(0, 16000) }];
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
