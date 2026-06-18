/**
 * Workflow Mode Config
 *
 * Single source of truth for the per-complexity-tier workflow definitions
 * (lightweight / standard / comprehensive). Settings are persisted in the
 * `WorkflowModeConfig` table and editable from the AI agent management page;
 * the orchestrator, role-resolver, and the frontend all DERIVE their phase
 * sequence from here instead of hardcoding three (previously duplicated and
 * drift-prone) transition tables.
 *
 * The status state machine is fixed, so a mode is configured by toggling the
 * OPTIONAL phases (plan / review / auto-verify) rather than by arbitrary
 * reordering — this keeps every generated transition table valid.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import type { RoleTransition, WorkflowMode } from './workflow-types';

const log = createLogger('workflow-mode-config');

/** Editable settings for one complexity tier. */
export interface WorkflowModeSettings {
  mode: WorkflowMode;
  /** Include the planner phase (research → plan). */
  includePlan: boolean;
  /** Include the plan-review phase (only meaningful when includePlan). */
  includeReview: boolean;
  /** Use auto_verifier instead of verifier for the verify phase. */
  autoVerify: boolean;
  /** Inclusive complexity-score range that auto-selects this mode. */
  complexityMin: number;
  complexityMax: number;
  isEnabled: boolean;
}

/** Built-in defaults — used to seed the table and as a fallback. */
export const DEFAULT_MODE_SETTINGS: Record<WorkflowMode, WorkflowModeSettings> = {
  lightweight: {
    mode: 'lightweight',
    includePlan: false,
    includeReview: false,
    autoVerify: true,
    complexityMin: 0,
    complexityMax: 35,
    isEnabled: true,
  },
  standard: {
    mode: 'standard',
    includePlan: true,
    includeReview: false,
    autoVerify: false,
    complexityMin: 36,
    complexityMax: 70,
    isEnabled: true,
  },
  comprehensive: {
    mode: 'comprehensive',
    includePlan: true,
    includeReview: true,
    autoVerify: false,
    complexityMin: 71,
    complexityMax: 100,
    isEnabled: true,
  },
};

const MODE_LABELS: Record<WorkflowMode, { name: string; description: string }> = {
  lightweight: { name: '軽量', description: 'バグ修正・UI調整・軽微な変更' },
  standard: { name: '標準', description: '中規模の機能追加・リファクタリング' },
  comprehensive: { name: '詳細', description: '大規模機能・アーキテクチャ変更' },
};

// In-memory cache so the orchestrator does not hit the DB on every phase.
let cache: Record<WorkflowMode, WorkflowModeSettings> | null = null;

/** Drop the cache so the next read reflects a just-saved change. */
export function invalidateModeConfigCache(): void {
  cache = null;
}

/**
 * Parse a persisted row's `stepDefinitions` JSON into the toggle settings.
 * Falls back to the mode's built-in defaults for any missing field.
 */
function parseRow(row: {
  mode: string;
  stepDefinitions: string;
  complexityMin: number;
  complexityMax: number;
  isEnabled: boolean;
}): WorkflowModeSettings {
  const mode = row.mode as WorkflowMode;
  const fallback = DEFAULT_MODE_SETTINGS[mode] ?? DEFAULT_MODE_SETTINGS.standard;
  let toggles: { includePlan?: boolean; includeReview?: boolean; autoVerify?: boolean } = {};
  try {
    const parsed = JSON.parse(row.stepDefinitions || '{}');
    toggles = parsed?.phases ?? parsed ?? {};
  } catch {
    /* keep fallback */
  }
  return {
    mode,
    includePlan: toggles.includePlan ?? fallback.includePlan,
    includeReview: toggles.includeReview ?? fallback.includeReview,
    autoVerify: toggles.autoVerify ?? fallback.autoVerify,
    complexityMin: row.complexityMin ?? fallback.complexityMin,
    complexityMax: row.complexityMax ?? fallback.complexityMax,
    isEnabled: row.isEnabled ?? fallback.isEnabled,
  };
}

/** Serialize toggle settings into the row's `stepDefinitions` JSON shape. */
function toggleJson(s: Pick<WorkflowModeSettings, 'includePlan' | 'includeReview' | 'autoVerify'>) {
  return JSON.stringify({
    phases: {
      includePlan: s.includePlan,
      includeReview: s.includeReview,
      autoVerify: s.autoVerify,
    },
  });
}

/**
 * Pick the workflow mode whose (UI-editable) complexity range contains the given
 * score, considering only enabled modes — so research-assessed complexity can
 * dynamically select the workflow. Falls back to default thresholds, then any
 * enabled mode.
 *
 * @param score - 0-100 complexity score. / 0-100の複雑度スコア
 * @returns The selected workflow mode. / 選択されたワークフローモード
 */
export async function selectModeByComplexity(score: number): Promise<WorkflowMode> {
  const all = await getAllModeSettings();
  const order: WorkflowMode[] = ['lightweight', 'standard', 'comprehensive'];
  for (const m of order) {
    const s = all[m];
    if (s.isEnabled && score >= s.complexityMin && score <= s.complexityMax) return m;
  }
  if (score <= 35 && all.lightweight.isEnabled) return 'lightweight';
  if (score <= 70 && all.standard.isEnabled) return 'standard';
  if (all.comprehensive.isEnabled) return 'comprehensive';
  return order.find((m) => all[m].isEnabled) ?? 'comprehensive';
}

/** Tier rank of each mode (ceremony level): lightweight < standard < comprehensive. */
export const MODE_TIER: Record<WorkflowMode, number> = {
  lightweight: 0,
  standard: 1,
  comprehensive: 2,
};

/**
 * Return the higher-ceremony of two modes. Used so research-assessed complexity
 * can only UPGRADE the provisional mode, never downgrade it — a downgrade would
 * drop the plan phase after research was already written assuming one.
 *
 * @param a - First mode. / モードA
 * @param b - Second mode. / モードB
 * @returns The higher-tier mode. / 上位ティアのモード
 */
export function higherMode(a: WorkflowMode, b: WorkflowMode): WorkflowMode {
  return MODE_TIER[a] >= MODE_TIER[b] ? a : b;
}

/**
 * Bias a WEAK (pre-research, metadata-only) complexity estimate upward: only
 * trust 'lightweight' when the score is unambiguously low, otherwise step up to
 * 'standard'. The pre-research signal is derived from title/description/spec
 * keywords, not the real code, so under-planning is the dangerous failure — a
 * little over-process (an unnecessary plan) is the safe one. Pure/testable.
 *
 * @param base - Mode that the raw thresholds would select. / 閾値による素のモード
 * @param score - The (weak) metadata complexity score. / メタデータ複雑度スコア
 * @param standardEnabled - Whether 'standard' is enabled (else keep base). / standard有効か
 * @param lightweightConfidentMax - Score at/below which 'lightweight' is trusted. / lightweightを信頼する上限
 * @returns The biased provisional mode. / バイアス後の暫定モード
 */
export function applyProvisionalBias(
  base: WorkflowMode,
  score: number,
  standardEnabled: boolean,
  lightweightConfidentMax: number,
): WorkflowMode {
  if (base === 'lightweight' && score > lightweightConfidentMax && standardEnabled) {
    return 'standard';
  }
  return base;
}

/**
 * Select the PROVISIONAL workflow mode from a pre-research (metadata) complexity
 * score, biased toward 'standard' for ambiguous scores (see applyProvisionalBias).
 * Run before the researcher so the phase chain and the researcher's prompt are
 * mode-aware from the start; research-assessed complexity refines it afterward.
 *
 * @param score - Pre-research metadata complexity score (0-100). / 事前メタ複雑度
 * @returns The provisional mode. / 暫定モード
 */
export async function selectProvisionalMode(score: number): Promise<WorkflowMode> {
  const base = await selectModeByComplexity(score);
  const all = await getAllModeSettings();
  // Trust 'lightweight' only in the lower half of its configured band.
  const lightweightConfidentMax = Math.floor(all.lightweight.complexityMax / 2);
  return applyProvisionalBias(base, score, all.standard.isEnabled, lightweightConfidentMax);
}

/**
 * Load all three mode settings, seeding the table with defaults on first use.
 * Cached in-memory; call invalidateModeConfigCache() after a write.
 *
 * @returns Settings keyed by mode. / モード別設定
 */
export async function getAllModeSettings(): Promise<Record<WorkflowMode, WorkflowModeSettings>> {
  if (cache) return cache;
  try {
    const rows = await prisma.workflowModeConfig.findMany();
    const byMode = new Map(rows.map((r) => [r.mode, r]));

    // Seed any missing mode with its default.
    const missing = (Object.keys(DEFAULT_MODE_SETTINGS) as WorkflowMode[]).filter(
      (m) => !byMode.has(m),
    );
    if (missing.length > 0) {
      await prisma.workflowModeConfig
        .createMany({
          data: missing.map((m) => {
            const d = DEFAULT_MODE_SETTINGS[m];
            return {
              mode: m,
              name: MODE_LABELS[m].name,
              description: MODE_LABELS[m].description,
              stepDefinitions: toggleJson(d),
              complexityMin: d.complexityMin,
              complexityMax: d.complexityMax,
              isEnabled: d.isEnabled,
            };
          }),
        })
        .catch((err) => log.warn({ err }, '[mode-config] Seed createMany failed'));
      const reloaded = await prisma.workflowModeConfig.findMany();
      reloaded.forEach((r) => byMode.set(r.mode, r));
    }

    const result = {} as Record<WorkflowMode, WorkflowModeSettings>;
    for (const m of Object.keys(DEFAULT_MODE_SETTINGS) as WorkflowMode[]) {
      const row = byMode.get(m);
      result[m] = row ? parseRow(row) : DEFAULT_MODE_SETTINGS[m];
    }
    cache = result;
    return result;
  } catch (err) {
    log.warn({ err }, '[mode-config] DB read failed — using built-in defaults');
    return DEFAULT_MODE_SETTINGS;
  }
}

/** Resolve a single mode's settings. */
export async function getModeSettings(mode: WorkflowMode): Promise<WorkflowModeSettings> {
  const all = await getAllModeSettings();
  return all[mode] ?? DEFAULT_MODE_SETTINGS[mode] ?? DEFAULT_MODE_SETTINGS.standard;
}

/**
 * Update one mode's settings and invalidate the cache.
 *
 * @param mode - Mode to update. / 対象モード
 * @param patch - Partial settings to apply. / 適用する部分設定
 * @returns The updated settings. / 更新後の設定
 */
export async function updateModeSettings(
  mode: WorkflowMode,
  patch: Partial<Omit<WorkflowModeSettings, 'mode'>>,
): Promise<WorkflowModeSettings> {
  const current = await getModeSettings(mode);
  const next: WorkflowModeSettings = { ...current, ...patch, mode };
  await prisma.workflowModeConfig.upsert({
    where: { mode },
    update: {
      stepDefinitions: toggleJson(next),
      complexityMin: next.complexityMin,
      complexityMax: next.complexityMax,
      isEnabled: next.isEnabled,
    },
    create: {
      mode,
      name: MODE_LABELS[mode]?.name ?? mode,
      description: MODE_LABELS[mode]?.description ?? null,
      stepDefinitions: toggleJson(next),
      complexityMin: next.complexityMin,
      complexityMax: next.complexityMax,
      isEnabled: next.isEnabled,
    },
  });
  invalidateModeConfigCache();
  return next;
}

/**
 * Build the status→RoleTransition map for a mode from its settings. This is the
 * generation step that replaces the previously-hardcoded COMPREHENSIVE/STANDARD/
 * LIGHTWEIGHT transition tables.
 *
 * @param s - Mode settings. / モード設定
 * @returns Transition table keyed by current workflowStatus. / 遷移表
 */
export function buildTransitions(s: WorkflowModeSettings): Record<string, RoleTransition> {
  const t: Record<string, RoleTransition> = {
    draft: { role: 'researcher', outputFile: 'research', nextStatus: 'research_done' },
  };
  if (s.includePlan) {
    t.research_done = { role: 'planner', outputFile: 'plan', nextStatus: 'plan_created' };
    if (s.includeReview) {
      // Review keeps the status at plan_created (it annotates the plan).
      t.plan_created = { role: 'reviewer', outputFile: 'question', nextStatus: 'plan_created' };
    }
    t.plan_approved = { role: 'implementer', outputFile: null, nextStatus: 'in_progress' };
  } else {
    // No plan phase — implement straight after research.
    t.research_done = { role: 'implementer', outputFile: null, nextStatus: 'in_progress' };
  }
  t.in_progress = {
    role: s.autoVerify ? 'auto_verifier' : 'verifier',
    outputFile: 'verify',
    nextStatus: 'verify_done',
  };
  return t;
}

/** Build the status→role map (role only) used by the role-resolver. */
export function buildRoleByStatus(s: WorkflowModeSettings): Record<string, RoleTransition['role']> {
  const transitions = buildTransitions(s);
  const map: Record<string, RoleTransition['role']> = {};
  for (const [status, tr] of Object.entries(transitions)) map[status] = tr.role;
  return map;
}

/**
 * Pick the mode whose configured complexity range contains the score. Falls
 * back to the legacy 35/70 split if no enabled mode matches.
 *
 * @param score - Complexity score 0-100. / 複雑度スコア
 * @param all - All mode settings. / 全モード設定
 * @returns Recommended mode. / 推奨モード
 */
export function recommendModeFromSettings(
  score: number,
  all: Record<WorkflowMode, WorkflowModeSettings>,
): WorkflowMode {
  const match = (Object.values(all) as WorkflowModeSettings[]).find(
    (s) => s.isEnabled && score >= s.complexityMin && score <= s.complexityMax,
  );
  if (match) return match.mode;
  return score <= 35 ? 'lightweight' : score <= 70 ? 'standard' : 'comprehensive';
}
