/**
 * phase-providers
 *
 * Decides which providers a workflow phase may run on from what this host can
 * actually execute — the CLI answers, is logged in, and is not in cooldown —
 * and keeps the agent configs that run them in step with that. This replaces
 * the per-role manual choice: hand-set agents and model ids went stale while
 * the model tier table moved on (2026-11-20: the only agent was pinned to
 * `claude-opus-4-8` and no Codex agent existed, so a cross-provider verifier
 * still ran on Claude). Not responsible for picking the model; SmartRouter
 * does that from the tier table within the providers returned here.
 */
import { createLogger } from '../../config/logger';
import type { Provider } from '../ai/model-discovery/types';
import type { VendorAvailability } from '../ai/model-tier-table/usable-vendors';

const log = createLogger('workflow:phase-providers');

/** Providers a phase can run on, in route order (the tiebreak), with the CLI agent for each. */
const PHASE_ROUTES: ReadonlyArray<{
  vendor: 'anthropic' | 'openai';
  provider: Provider;
  agentType: string;
  name: string;
}> = [
  { vendor: 'anthropic', provider: 'claude', agentType: 'claude-code', name: 'Claude Code' },
  { vendor: 'openai', provider: 'openai', agentType: 'codex', name: 'Codex' },
];

/** Every provider SmartRouter knows; those without a phase route are always excluded. */
const ALL_PROVIDERS: readonly Provider[] = ['claude', 'openai', 'gemini', 'ollama'];

/** Providers a phase may use right now. */
export interface PhaseProviders {
  /** Usable providers in route order. */
  usable: Provider[];
  /** Providers SmartRouter must not pick for a phase. */
  excluded: Provider[];
  /** Providers in cooldown — unusable now, expected back. */
  cooled: Provider[];
  /** Why each excluded provider is out. */
  reasons: Partial<Record<Provider, string>>;
}

/**
 * Turn vendor availability into the provider sets a phase route uses.
 *
 * @param availability - Usable vendors and the reasons for the rest / 利用可否
 * @returns Usable and excluded providers / 使える・除外するプロバイダ
 */
export function phaseProvidersFrom(availability: VendorAvailability): PhaseProviders {
  const usable = PHASE_ROUTES.filter((r) => availability.usable.includes(r.vendor)).map(
    (r) => r.provider,
  );
  const reasons: PhaseProviders['reasons'] = {};
  const cooled: Provider[] = [];
  for (const route of PHASE_ROUTES) {
    const miss = availability.unavailable.find((u) => u.vendor === route.vendor);
    if (miss) reasons[route.provider] = miss.reason;
    if (miss?.resumeAt) cooled.push(route.provider);
  }
  reasons.gemini = 'ワークフローのフェーズを実行する CLI エージェントがない';
  reasons.ollama = 'ワークフローのフェーズを実行する CLI エージェントがない';
  return {
    usable,
    excluded: ALL_PROVIDERS.filter((p) => !usable.includes(p)),
    cooled,
    reasons,
  };
}

/** The agent-config fields the sync reads. */
export interface PhaseAgentRow {
  id: number;
  agentType: string;
  isActive: boolean;
  isInstalled: boolean;
  isDefault: boolean;
  modelId: string | null;
}

/** Writes that bring the agent configs in step with the usable providers. */
export interface PhaseAgentSyncPlan {
  create: Array<{ agentType: string; name: string }>;
  update: Array<{
    id: number;
    data: Partial<Pick<PhaseAgentRow, 'isActive' | 'isInstalled' | 'modelId'>>;
  }>;
}

/**
 * Plan the agent-config writes for the usable providers. Pure.
 *
 * A usable provider gets one active row with no pinned model; a provider that
 * is no longer usable is deactivated, unless it is only in cooldown.
 *
 * @param rows - Current agent configs / 現在のエージェント設定
 * @param usable - Usable providers / 使えるプロバイダ
 * @param opts.cooledProviders - Providers in cooldown / クールダウン中のプロバイダ
 * @returns Rows to create and update / 作成・更新する行
 */
export function planPhaseAgentSync(
  rows: readonly PhaseAgentRow[],
  usable: readonly Provider[],
  opts: { cooledProviders?: readonly Provider[] } = {},
): PhaseAgentSyncPlan {
  const plan: PhaseAgentSyncPlan = { create: [], update: [] };
  for (const route of PHASE_ROUTES) {
    // The oldest row is the one kept; copies left by an earlier race (three
    // Codex rows on 2026-11-20) are deactivated, not deleted — executions
    // still reference them.
    const [row, ...copies] = rows
      .filter((r) => r.agentType === route.agentType)
      .sort((a, b) => a.id - b.id);
    for (const copy of copies) {
      if (copy.isActive) plan.update.push({ id: copy.id, data: { isActive: false } });
    }
    const data: PhaseAgentSyncPlan['update'][number]['data'] = {};
    if (usable.includes(route.provider)) {
      if (!row) {
        plan.create.push({ agentType: route.agentType, name: route.name });
        continue;
      }
      if (!row.isActive) data.isActive = true;
      if (!row.isInstalled) data.isInstalled = true;
      // The router picks the model per phase from the tier table; a pinned id
      // is only read when an override is dropped, and that is where stale ids
      // like `claude-opus-4-8` surfaced.
      if (row.modelId !== null) data.modelId = null;
    } else if (row?.isActive && !opts.cooledProviders?.includes(route.provider)) {
      data.isActive = false;
    }
    if (row && Object.keys(data).length > 0) plan.update.push({ id: row.id, data });
  }
  plan.update.sort((a, b) => a.id - b.id);
  return plan;
}

/** Injectable pieces of {@link resolvePhaseProviders}. */
export interface ResolvePhaseProvidersDeps {
  availability?: () => Promise<VendorAvailability>;
  sync?: (providers: PhaseProviders) => Promise<void>;
  now?: () => number;
}

const CACHE_MS = 60_000;
let cached: { at: number; value: PhaseProviders } | null = null;
/**
 * The resolve in progress. Concurrent callers share it: on a cold cache every
 * phase routed at once used to probe and sync on its own, and each sync saw
 * no Codex row yet and created one.
 */
let inflight: Promise<PhaseProviders> | null = null;

/** Probe the CLIs and cooldowns. Same sources the review jury uses. */
async function probeAvailability(): Promise<VendorAvailability> {
  const [{ resolveConfiguredVendors }, { usableVendorsAmong }] = await Promise.all([
    import('../ai/model-tier-table/configured-vendors'),
    import('../ai/model-tier-table/usable-vendors'),
  ]);
  // Phases always run through a CLI agent, whatever the auxiliary AI mode is.
  const configured = await resolveConfiguredVendors('cli');
  return usableVendorsAmong(configured.configured, configured.unconfigured);
}

/**
 * The providers a phase may use now, with the agent configs synced to match.
 * Cached for a minute: the CLI probes spawn processes.
 *
 * Fails safe toward running: a probe error keeps Claude usable, the provider
 * every host that runs rapitas has.
 *
 * @param deps - Injectable availability and clock / テスト用の注入
 * @returns Usable and excluded providers / 使える・除外するプロバイダ
 */
export async function resolvePhaseProviders(
  deps: ResolvePhaseProvidersDeps = {},
): Promise<PhaseProviders> {
  const now = (deps.now ?? Date.now)();
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  if (inflight) return inflight;
  inflight = (async () => {
    let value: PhaseProviders;
    try {
      value = phaseProvidersFrom(await (deps.availability ?? probeAvailability)());
    } catch (err) {
      log.warn({ err }, '[phase-providers] availability probe failed — keeping Claude only');
      value = phaseProvidersFrom({ usable: ['anthropic'], unavailable: [] });
    }
    await (deps.sync ?? syncPhaseAgentConfigs)(value).catch((err) =>
      log.warn({ err }, '[phase-providers] agent config sync failed'),
    );
    cached = { at: now, value };
    return value;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/**
 * Apply {@link planPhaseAgentSync} to the database.
 *
 * @param providers - Result of {@link phaseProvidersFrom} / 使えるプロバイダ
 */
export async function syncPhaseAgentConfigs(providers: PhaseProviders): Promise<void> {
  const { prisma } = await import('../../config/database');
  const rows = await prisma.aIAgentConfig.findMany({
    where: { agentType: { in: PHASE_ROUTES.map((r) => r.agentType) } },
    select: {
      id: true,
      agentType: true,
      isActive: true,
      isInstalled: true,
      isDefault: true,
      modelId: true,
    },
  });
  const plan = planPhaseAgentSync(rows, providers.usable, {
    cooledProviders: providers.cooled,
  });
  for (const c of plan.create) {
    await prisma.aIAgentConfig.create({
      data: { ...c, isActive: true, isInstalled: true, modelId: null },
    });
  }
  for (const u of plan.update) {
    await prisma.aIAgentConfig.update({ where: { id: u.id }, data: u.data });
  }
  if (plan.create.length > 0 || plan.update.length > 0) {
    log.info(
      { usable: providers.usable, created: plan.create, updated: plan.update },
      '[phase-providers] agent configs synced to the usable providers',
    );
  }
}

/** Drop the cached result (tests, and after a cooldown changes). */
export function resetPhaseProvidersCache(): void {
  cached = null;
  inflight = null;
}
