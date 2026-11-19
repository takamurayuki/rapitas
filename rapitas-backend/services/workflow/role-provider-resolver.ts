/**
 * role-provider-resolver
 *
 * Computes the SmartRouter provider inputs for a workflow role from the
 * providers this host can run (phase-providers.ts), never from a manual pick:
 *  - providers with no usable CLI agent are always excluded
 *  - non-review roles follow the provider the upstream phase used, else the
 *    first usable provider in route order
 *  - verifier roles exclude the upstream provider whenever another usable
 *    provider exists, and prefer that one
 *
 * NOTE: The per-role override, UserSettings.defaultAiProvider and the default
 * agent's provider are no longer read (2026-11-20). Hand-set values went
 * stale while the model tier table moved on, and a cross-provider verifier
 * still ran on Claude because no Codex agent had been registered by hand.
 *
 * The cross-provider rule mitigates LLM self-evaluation bias documented in
 * LLM-as-judge research: a Claude-written implementation gets a stricter
 * critique when reviewed by a GPT-class model than by another Claude session.
 */
import { prisma } from '../../config/database';
import type { Provider } from '../ai/model-discovery';
import { createLogger } from '../../config/logger';
import { NOT_REVIEW_COST_ROW } from '../agents/review-cost-rows';
import type { PhaseProviders } from './phase-providers';

const log = createLogger('role-provider-resolver');

/** Roles that judge another phase's work and so prefer a different provider. */
const REVIEW_ROLES: ReadonlySet<string> = new Set(['verifier', 'auto_verifier']);

/** Injectable pieces of {@link resolveRoleProviderPreferences}. */
export interface RoleProviderDeps {
  phaseProviders?: () => Promise<PhaseProviders>;
}

/**
 * Resolve provider preferences for the given role + task.
 *
 * @param role - Workflow role being executed (researcher / planner / ...). / 実行中のロール
 * @param taskId - Task ID, used to look up the upstream phase. / タスクID
 * @param deps - Injectable provider availability / テスト用の注入
 * @returns SmartRouter-compatible preference object. / SmartRouter 用の入力
 */
export async function resolveRoleProviderPreferences(
  role: string,
  taskId: number,
  deps: RoleProviderDeps = {},
): Promise<{ preferredProvider?: Provider; excludeProviders?: Provider[] }> {
  const phase = await (
    deps.phaseProviders ?? (async () => (await import('./phase-providers')).resolvePhaseProviders())
  )();
  const exclude: Provider[] = [...phase.excluded];
  const upstream = await getUpstreamProvider(taskId);

  if (REVIEW_ROLES.has(role)) {
    if (upstream && phase.usable.some((p) => p !== upstream)) {
      exclude.push(upstream);
    } else if (upstream) {
      log.info({ role, upstream }, 'Cross-provider review skipped — no other usable provider');
    }
    return {
      preferredProvider: phase.usable.find((p) => !exclude.includes(p)),
      excludeProviders: exclude,
    };
  }
  // Provider consistency for the build chain: research → plan → implement run
  // on ONE provider so the implementer reads a plan written by its own family.
  const preferredProvider =
    upstream && phase.usable.includes(upstream) ? upstream : phase.usable[0];
  return { preferredProvider, excludeProviders: exclude };
}

/**
 * Look at the most recent terminal AgentExecution on this task that ran a
 * non-review role and return its provider (derived from `modelName`).
 * Returns `null` when nothing is found — the router then proceeds without
 * exclusion, falling back to whatever the preference dictates.
 */
async function getUpstreamProvider(taskId: number): Promise<Provider | null> {
  const recent = await prisma.agentExecution.findFirst({
    where: {
      ...NOT_REVIEW_COST_ROW,
      session: {
        config: { taskId },
      },
      status: 'completed',
      modelName: { not: null },
    },
    select: { modelName: true },
    orderBy: { completedAt: 'desc' },
  });
  if (!recent?.modelName) return null;
  return inferProviderFromModelId(recent.modelName);
}

/** Map a model id to its provider family using simple substring rules. */
export function inferProviderFromModelId(modelId: string): Provider | null {
  const m = modelId.toLowerCase();
  if (/(ollama|llama|mistral|qwen|deepseek|phi|gemma|local)/.test(m)) return 'ollama';
  if (/(claude|opus|sonnet|haiku|anthropic)/.test(m)) return 'claude';
  // Codex CLI exposes models named `codex-auto`, `codex-auto-review`,
  // `codex-mini-latest` etc. — these are OpenAI-family but the older
  // regex (`^(gpt-|o\d|openai|chatgpt)`) didn't match the `codex-` prefix.
  // The miss caused SmartRouter's selection (`codex-auto-review`) to land
  // on a claude-code agent, which then failed at spawn time with
  // "There's an issue with the selected model (codex-auto-review)".
  if (/^(gpt-|o\d|openai|chatgpt|codex(-|$))/.test(m)) return 'openai';
  if (/^gemini|^google/.test(m)) return 'gemini';
  return null;
}
