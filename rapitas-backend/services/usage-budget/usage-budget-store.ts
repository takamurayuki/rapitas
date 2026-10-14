/**
 * usage-budget-store
 *
 * Persistence for the usage budget through a narrow `UsageBudgetDb` interface
 * (only the delegates this feature uses) and the `UsageBudgetStore` the
 * service depends on. NOT responsible for thresholds, forecasts or validation.
 */
import { prisma } from '../../config/database';
import {
  USAGE_BUDGET_UNITS,
  type BudgetConfig,
  type ClassificationRule,
  type ThemeShare,
  type UsageBudgetUnit,
} from './usage-budget-types';

const BUDGET_ID = 1;

interface BudgetRow {
  unit: string;
  monthlyLimit: number;
  snoozedUntil: Date | null;
  acknowledgedKey: string | null;
  lastNotifiedKey: string | null;
}

interface RuleRow {
  id: number;
  themeId: number;
  keyword: string;
  sortOrder: number;
  enabled: boolean;
}

type BudgetPatch = Partial<Omit<BudgetRow, 'unit'>> & { unit?: UsageBudgetUnit };

/** Only the Prisma delegates this feature touches. */
export interface UsageBudgetDb {
  usageBudget: {
    findUnique(args: { where: { id: number } }): Promise<BudgetRow | null>;
    upsert(args: {
      where: { id: number };
      create: BudgetPatch & { id: number; unit: UsageBudgetUnit; monthlyLimit: number };
      update: BudgetPatch;
    }): Promise<unknown>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: BudgetPatch;
    }): Promise<{ count: number }>;
  };
  usageBudgetThemeShare: {
    findMany(args: { where: { budgetId: number } }): Promise<ThemeShare[]>;
    deleteMany(args: { where: { budgetId: number } }): Promise<unknown>;
    create(args: { data: ThemeShare & { budgetId: number } }): Promise<unknown>;
  };
  usageClassificationRule: {
    findMany(args: { orderBy: Array<Record<string, 'asc' | 'desc'>> }): Promise<RuleRow[]>;
    deleteMany(args: Record<string, never>): Promise<unknown>;
    create(args: { data: Omit<ClassificationRule, 'id'> }): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: UsageBudgetDb) => Promise<T>): Promise<T>;
}

/** Persistence operations the usage-budget service depends on. */
export interface UsageBudgetStore {
  getConfig(): Promise<BudgetConfig | null>;
  getShares(): Promise<ThemeShare[]>;
  saveBudget(p: {
    unit: UsageBudgetUnit;
    monthlyLimit: number;
    shares?: ThemeShare[];
  }): Promise<void>;
  updateConfig(patch: BudgetPatch): Promise<void>;
  /** CAS: set lastNotifiedKey to `key` only when it differs. true = this caller won. */
  claimNotification(key: string): Promise<boolean>;
  /** Undo a claim whose notification failed, only if nobody re-claimed since. */
  releaseNotification(key: string, previous: string | null): Promise<void>;
  getRules(): Promise<ClassificationRule[]>;
  replaceRules(rules: ClassificationRule[]): Promise<void>;
}

// NOTE: Cast through unknown on purpose — the generated Prisma client only
// gains these delegates after the user restarts the server (prisma generate is
// never run by agents), and tests inject an in-memory UsageBudgetDb. A name
// drift against usage-budget.prisma is caught by usage-budget-schema-drift.test.ts.
const defaultDb = prisma as unknown as UsageBudgetDb;

/**
 * Fail loudly (instead of a TypeError deep inside a handler) when the running
 * Prisma client predates usage-budget.prisma.
 */
function assertDelegates(db: UsageBudgetDb): void {
  if (!db.usageBudget || !db.usageBudgetThemeShare || !db.usageClassificationRule) {
    throw new Error(
      'UsageBudget models are missing from the Prisma client — restart the server to regenerate it',
    );
  }
}

function toUnit(raw: string): UsageBudgetUnit {
  return (USAGE_BUDGET_UNITS as readonly string[]).includes(raw)
    ? (raw as UsageBudgetUnit)
    : 'tokens';
}

/**
 * Build a store over a UsageBudgetDb (the live Prisma client by default).
 *
 * @param db - Delegate source / Prisma delegate の供給元
 * @returns Store / ストア
 */
export function createUsageBudgetStore(db: UsageBudgetDb = defaultDb): UsageBudgetStore {
  const ready = (): UsageBudgetDb => {
    assertDelegates(db);
    return db;
  };

  return {
    async getConfig() {
      const row = await ready().usageBudget.findUnique({ where: { id: BUDGET_ID } });
      if (!row) return null;
      return {
        unit: toUnit(row.unit),
        monthlyLimit: row.monthlyLimit,
        snoozedUntil: row.snoozedUntil,
        acknowledgedKey: row.acknowledgedKey,
        lastNotifiedKey: row.lastNotifiedKey,
      };
    },

    async getShares() {
      const rows = await ready().usageBudgetThemeShare.findMany({ where: { budgetId: BUDGET_ID } });
      return rows.map((r) => ({ themeId: r.themeId, sharePercent: r.sharePercent }));
    },

    async saveBudget({ unit, monthlyLimit, shares }) {
      await ready().$transaction(async (tx) => {
        await tx.usageBudget.upsert({
          where: { id: BUDGET_ID },
          create: { id: BUDGET_ID, unit, monthlyLimit },
          update: { unit, monthlyLimit },
        });
        if (shares) {
          await tx.usageBudgetThemeShare.deleteMany({ where: { budgetId: BUDGET_ID } });
          for (const s of shares) {
            await tx.usageBudgetThemeShare.create({
              data: { budgetId: BUDGET_ID, themeId: s.themeId, sharePercent: s.sharePercent },
            });
          }
        }
      });
    },

    async updateConfig(patch) {
      await ready().usageBudget.updateMany({ where: { id: BUDGET_ID }, data: patch });
    },

    async claimNotification(key) {
      // NOTE: `{ not: key }` alone never matches NULL in SQL, so the first-ever
      // claim (lastNotifiedKey IS NULL) needs its own OR branch.
      const { count } = await ready().usageBudget.updateMany({
        where: {
          id: BUDGET_ID,
          OR: [{ lastNotifiedKey: null }, { lastNotifiedKey: { not: key } }],
        },
        data: { lastNotifiedKey: key },
      });
      return count === 1;
    },

    async releaseNotification(key, previous) {
      await ready().usageBudget.updateMany({
        where: { id: BUDGET_ID, lastNotifiedKey: key },
        data: { lastNotifiedKey: previous },
      });
    },

    async getRules() {
      const rows = await ready().usageClassificationRule.findMany({
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });
      return rows.map((r) => ({
        id: r.id,
        themeId: r.themeId,
        keyword: r.keyword,
        sortOrder: r.sortOrder,
        enabled: r.enabled,
      }));
    },

    async replaceRules(rules) {
      await ready().$transaction(async (tx) => {
        await tx.usageClassificationRule.deleteMany({});
        for (const r of rules) {
          await tx.usageClassificationRule.create({
            data: {
              themeId: r.themeId,
              keyword: r.keyword,
              sortOrder: r.sortOrder,
              enabled: r.enabled,
            },
          });
        }
      });
    },
  };
}
