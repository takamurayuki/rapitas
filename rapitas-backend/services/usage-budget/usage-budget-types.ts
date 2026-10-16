/**
 * usage-budget-types
 *
 * Shared types for the AI usage budget feature (observation → advisory monthly
 * budget → threshold prompts). Types and constants only — no logic.
 */

/** Budget units: a budget counts either tokens or executions, never both. */
export const USAGE_BUDGET_UNITS = ['tokens', 'executions'] as const;
export type UsageBudgetUnit = (typeof USAGE_BUDGET_UNITS)[number];

/** Threshold levels, ordered from lowest to highest. */
export const BUDGET_LEVELS = ['none', 'warn80', 'warn90', 'exceeded'] as const;
export type BudgetLevel = (typeof BUDGET_LEVELS)[number];

/** The three choices of the threshold confirmation dialog. */
export const PROMPT_ACTIONS = ['continue', 'defer', 'change_limit'] as const;
export type PromptAction = (typeof PROMPT_ACTIONS)[number];

/** themeId used for executions that resolve to no theme (未分類). */
export const UNCLASSIFIED_THEME_ID = 0;

/** How long 「後回し」 suppresses the prompt and notification. */
export const DEFER_DURATION_MS = 24 * 60 * 60 * 1000;

/** Accepted range for the client timezone offset (UTC-14:00 … UTC+14:00). */
export const TZ_OFFSET_MIN = -840;
export const TZ_OFFSET_MAX = 840;

/** One execution reduced to the fields the budget math needs. */
export interface ExecutionUsageSample {
  /** startedAt ?? createdAt */
  at: Date;
  tokens: number;
  durationMs: number;
  costUsd: number;
  themeId: number;
}

/** Persisted budget row (single row, id = 1). */
export interface BudgetConfig {
  unit: UsageBudgetUnit;
  monthlyLimit: number;
  snoozedUntil: Date | null;
  acknowledgedKey: string | null;
  lastNotifiedKey: string | null;
}

/** Manual per-theme allocation share (0–100). */
export interface ThemeShare {
  themeId: number;
  sharePercent: number;
}

/** Aggregation-only re-classification rule. */
export interface ClassificationRule {
  id?: number;
  themeId: number;
  keyword: string;
  sortOrder: number;
  enabled: boolean;
}

/** Progress and forecast for the current month. */
export interface BudgetProjection {
  used: number;
  limit: number;
  remaining: number;
  /** used / limit, for display only — levels are decided by integer comparison. */
  ratio: number;
  level: BudgetLevel;
  /** Trailing 7-day daily average (today included). */
  avg7: number;
  /** remaining / avg7, or null when there is no recent usage. */
  daysToExhaust: number | null;
  /** used + avg7 × days left in the month, or null when there is no recent usage. */
  projectedMonthEnd: number | null;
  daysLeftInMonth: number;
}

/** Usage and allocation of one theme in the current month. */
export interface ThemeBudgetUsage {
  themeId: number;
  themeName: string | null;
  used: number;
  sharePercent: number | null;
  /** monthlyLimit × sharePercent / 100, or null when no share is set. */
  allocated: number | null;
}

/** Suggested initial share, derived from the last 30 days (never saved). */
export interface SuggestedShare {
  themeId: number;
  themeName: string | null;
  sharePercent: number;
}

/** What the threshold dialog needs to render. */
export interface PendingPrompt {
  key: string;
  level: Exclude<BudgetLevel, 'none'>;
  unit: UsageBudgetUnit;
  used: number;
  limit: number;
  remaining: number;
  avg7: number;
  daysToExhaust: number | null;
  projectedMonthEnd: number | null;
}

/** Status payload of GET /usage-budget/status and POST /usage-budget/evaluate. */
export type UsageBudgetStatus =
  | {
      configured: false;
      suggestedShares: SuggestedShare[];
      suggestionReason: string | null;
    }
  | {
      configured: true;
      unit: UsageBudgetUnit;
      monthlyLimit: number;
      month: string;
      projection: BudgetProjection;
      shares: ThemeShare[];
      themes: ThemeBudgetUsage[];
      suggestedShares: SuggestedShare[];
      suggestionReason: string | null;
      snoozedUntil: string | null;
      pendingPrompt: PendingPrompt | null;
    };
