/**
 * role-provider-resolver
 *
 * Computes the SmartRouter inputs for a given workflow role:
 *  - `preferredProvider`: per-role override > global UserSettings default
 *  - `excludeProviders`: cross-provider review exclusions for reviewer /
 *    verifier roles, derived from previous AgentExecutions on the same task
 *
 * The cross-provider rule mitigates LLM self-evaluation bias documented in
 * LLM-as-judge research: a Claude-written implementation gets a stricter
 * critique when reviewed by a Gemini- or GPT-class model than by another
 * Claude session.
 */
import { prisma } from '../../config/database';
import type { Provider } from '../ai/model-discovery';

const VALID_PROVIDERS: ReadonlySet<Provider> = new Set(['claude', 'openai', 'gemini', 'ollama']);

/** Roles whose default behaviour is "use a different provider than upstream". */
const REVIEW_ROLES: ReadonlySet<string> = new Set(['reviewer', 'verifier', 'auto_verifier']);

/**
 * Resolve provider preferences for the given role + task.
 *
 * @param role - Workflow role being executed (researcher / planner / ...). / 実行中のロール
 * @param taskId - Task ID, used to look up upstream phases for exclusion. / タスクID
 * @returns SmartRouter-compatible preference object. / SmartRouter 用の入力
 */
export async function resolveRoleProviderPreferences(
  role: string,
  taskId: number,
): Promise<{ preferredProvider?: Provider; excludeProviders?: Provider[] }> {
  const [roleConfig, settings] = await Promise.all([
    prisma.workflowRoleConfig.findUnique({
      where: { role },
      select: {
        preferredProviderOverride: true,
      } as Record<string, true>,
    }),
    prisma.userSettings.findFirst({
      select: { defaultAiProvider: true },
    }),
  ]);

  const override = (roleConfig as Record<string, unknown> | null)?.preferredProviderOverride as
    | string
    | null
    | undefined;
  const globalDefault = settings?.defaultAiProvider as string | null | undefined;

  // `cross-provider` is a sentinel meaning "exclude upstream provider"; it is
  // not itself a Provider value.
  const isCrossProvider = override === 'cross-provider';
  const isExplicitProvider =
    !!override && override !== 'cross-provider' && VALID_PROVIDERS.has(override as Provider);

  // Resolution order: explicit role override > global default > undefined.
  // When the user picked `cross-provider`, no specific preferredProvider is
  // applied (any non-upstream provider is acceptable).
  const explicitPreference = isCrossProvider ? null : isExplicitProvider ? override : globalDefault;
  const preferredProvider =
    explicitPreference && VALID_PROVIDERS.has(explicitPreference as Provider)
      ? (explicitPreference as Provider)
      : undefined;

  // Auto-exclude upstream provider when:
  //  - User explicitly chose `cross-provider`, OR
  //  - Role is a review-style phase AND the user did NOT pin a specific
  //    provider. Pinning Claude to reviewer should honor that choice — the
  //    user clearly knows what they want.
  let excludeProviders: Provider[] | undefined;
  if (isCrossProvider || (!isExplicitProvider && REVIEW_ROLES.has(role))) {
    const upstream = await getUpstreamProvider(taskId);
    if (upstream) excludeProviders = [upstream];
  }

  return { preferredProvider, excludeProviders };
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
  if (/^(gpt-|o\d|openai|chatgpt)/.test(m)) return 'openai';
  if (/^gemini|^google/.test(m)) return 'gemini';
  return null;
}
