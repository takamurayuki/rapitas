/**
 * effectiveness
 *
 * Aggregates the durable `knowledge_effectiveness` samples written by
 * outcome-reinforcement.ts into the numbers that answer "does injected
 * knowledge actually help?" — the causal half of the self-learning claim.
 * Read-only; writing samples stays in outcome-reinforcement.ts.
 */
import { createLogger } from '../../config/logger';
import { queryEvents } from './timeline';
import type { EffectivenessResult } from './types';

const log = createLogger('memory:effectiveness');

/** One effectiveness sample as recorded on a task's terminal outcome. */
interface EffectivenessSample {
  success: boolean;
  injected: number;
  applied: number;
  fineGrained: boolean;
  used: number | null;
  wrong: number | null;
}

/** Aggregate view of how injected knowledge relates to task outcomes. */
export interface KnowledgeEffectiveness {
  /** Number of finished tasks sampled (injected + control combined). */
  sampledTasks: number;
  /** Success rate across ALL sampled tasks (0-1) — kept for compatibility. */
  successRate: number;
  /** Share of tasks where the agent filed a per-entry usage declaration (0-1). */
  declarationRate: number;
  /** Of declared tasks: average share of injected entries actually used (0-1). */
  usageRate: number;
  /** Total entries agents flagged as wrong/contradicting reality. */
  wrongFlagged: number;
  /** Average entries injected per sampled task. */
  avgInjected: number;
  /** Success rate of tasks that HAD knowledge injected (injected > 0). */
  injectedSuccessRate: number;
  /** Success rate of the CONTROL group — tasks that finished with no injection. */
  controlSuccessRate: number;
  /** Sample size of the injected group. */
  injectedSampleCount: number;
  /** Sample size of the control group. */
  controlSampleCount: number;
}

/** Coerce an unknown payload field to a finite number, else the fallback. */
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Compute aggregate effectiveness from raw samples. Pure and unit-testable.
 *
 * @param samples - Parsed effectiveness samples. / 効果サンプル
 * @returns Aggregate rates (zeroes when no samples). / 集計値
 */
export function aggregateEffectiveness(samples: EffectivenessSample[]): KnowledgeEffectiveness {
  const empty: KnowledgeEffectiveness = {
    sampledTasks: 0,
    successRate: 0,
    declarationRate: 0,
    usageRate: 0,
    wrongFlagged: 0,
    avgInjected: 0,
    injectedSuccessRate: 0,
    controlSuccessRate: 0,
    injectedSampleCount: 0,
    controlSampleCount: 0,
  };
  if (samples.length === 0) return empty;

  const declared = samples.filter((s) => s.fineGrained);
  const usageRates = declared
    .filter((s) => s.injected > 0 && s.used !== null)
    .map((s) => Math.min(1, (s.used as number) / s.injected));

  // Injected vs control split: `injected > 0` are tasks that had knowledge in
  // context, `injected === 0` are the control group (finished with none). The
  // gap between their success rates is the causal signal — a bare overall
  // successRate cannot tell "injection helped" from "these tasks were easy".
  const injectedGroup = samples.filter((s) => s.injected > 0);
  const controlGroup = samples.filter((s) => s.injected === 0);
  const successRateOf = (group: EffectivenessSample[]): number =>
    group.length > 0 ? group.filter((s) => s.success).length / group.length : 0;

  return {
    sampledTasks: samples.length,
    successRate: samples.filter((s) => s.success).length / samples.length,
    declarationRate: declared.length / samples.length,
    usageRate:
      usageRates.length > 0 ? usageRates.reduce((a, b) => a + b, 0) / usageRates.length : 0,
    wrongFlagged: samples.reduce((a, s) => a + (s.wrong ?? 0), 0),
    avgInjected: samples.reduce((a, s) => a + s.injected, 0) / samples.length,
    injectedSuccessRate: successRateOf(injectedGroup),
    controlSuccessRate: successRateOf(controlGroup),
    injectedSampleCount: injectedGroup.length,
    controlSampleCount: controlGroup.length,
  };
}

/**
 * Load recent effectiveness samples from the timeline and aggregate them.
 * Returns a discriminated result: `ok` with the aggregate (a genuine zero
 * aggregate stays `ok` with `sampledTasks: 0`), or `unknown` when the samples
 * could not be read at all — the caller can then distinguish "no data" from
 * "measurement unavailable" instead of both looking like a zero success rate.
 *
 * @param days - Look-back window in days. / 集計対象期間(日)
 * @returns `ok` aggregate or `unknown` on read failure. / 集計値 or 取得失敗
 */
export async function getKnowledgeEffectiveness(days = 30): Promise<EffectivenessResult> {
  try {
    const { events } = await queryEvents({
      eventType: 'knowledge_effectiveness',
      since: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
      limit: 1000,
    });
    const samples: EffectivenessSample[] = events.map((e) => {
      const p = e.payload as Record<string, unknown>;
      return {
        success: p.success === true,
        injected: num(p.injected),
        applied: num(p.applied),
        fineGrained: p.fineGrained === true,
        used: typeof p.used === 'number' ? p.used : null,
        wrong: typeof p.wrong === 'number' ? p.wrong : null,
      };
    });
    return { status: 'ok', data: aggregateEffectiveness(samples) };
  } catch (err) {
    log.warn({ err }, 'Failed to aggregate knowledge effectiveness');
    return { status: 'unknown', reason: err instanceof Error ? err.message : String(err) };
  }
}
