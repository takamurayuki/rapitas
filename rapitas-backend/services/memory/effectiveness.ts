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
  /** Number of finished tasks that had knowledge injected (sample size). */
  sampledTasks: number;
  /** Success rate of those tasks (0-1). */
  successRate: number;
  /** Share of tasks where the agent filed a per-entry usage declaration (0-1). */
  declarationRate: number;
  /** Of declared tasks: average share of injected entries actually used (0-1). */
  usageRate: number;
  /** Total entries agents flagged as wrong/contradicting reality. */
  wrongFlagged: number;
  /** Average entries injected per sampled task. */
  avgInjected: number;
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
  };
  if (samples.length === 0) return empty;

  const declared = samples.filter((s) => s.fineGrained);
  const usageRates = declared
    .filter((s) => s.injected > 0 && s.used !== null)
    .map((s) => Math.min(1, (s.used as number) / s.injected));

  return {
    sampledTasks: samples.length,
    successRate: samples.filter((s) => s.success).length / samples.length,
    declarationRate: declared.length / samples.length,
    usageRate:
      usageRates.length > 0 ? usageRates.reduce((a, b) => a + b, 0) / usageRates.length : 0,
    wrongFlagged: samples.reduce((a, s) => a + (s.wrong ?? 0), 0),
    avgInjected: samples.reduce((a, s) => a + s.injected, 0) / samples.length,
  };
}

/**
 * Load recent effectiveness samples from the timeline and aggregate them.
 * Best-effort: any failure returns the zero aggregate rather than breaking the
 * stats endpoint.
 *
 * @param days - Look-back window in days. / 集計対象期間(日)
 * @returns Aggregate effectiveness over the window. / 期間内の集計値
 */
export async function getKnowledgeEffectiveness(days = 30): Promise<KnowledgeEffectiveness> {
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
    return aggregateEffectiveness(samples);
  } catch (err) {
    log.warn({ err }, 'Failed to aggregate knowledge effectiveness');
    return aggregateEffectiveness([]);
  }
}
