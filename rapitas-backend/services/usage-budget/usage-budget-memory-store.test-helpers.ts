/**
 * usage-budget-memory-store test helpers
 *
 * In-memory UsageBudgetStore shared by the service and router tests. Mirrors
 * the real store's CAS semantics: a claim succeeds only when the key differs.
 */
import type { UsageBudgetStore } from './usage-budget-store';
import type { BudgetConfig, ClassificationRule, ThemeShare } from './usage-budget-types';

/** In-memory store; fields are public so tests can assert on state. */
export class MemoryStore implements UsageBudgetStore {
  config: BudgetConfig | null = null;
  shares: ThemeShare[] = [];
  rules: ClassificationRule[] = [];
  claims = 0;
  async getConfig() {
    return this.config ? { ...this.config } : null;
  }
  async getShares() {
    return [...this.shares];
  }
  async saveBudget(p: { unit: BudgetConfig['unit']; monthlyLimit: number; shares?: ThemeShare[] }) {
    this.config = {
      ...(this.config ?? {
        snoozedUntil: null,
        acknowledgedKey: null,
        lastNotifiedKey: null,
      }),
      unit: p.unit,
      monthlyLimit: p.monthlyLimit,
    };
    if (p.shares) this.shares = p.shares;
  }
  async updateConfig(patch: Partial<BudgetConfig>) {
    if (this.config) this.config = { ...this.config, ...patch };
  }
  async claimNotification(key: string) {
    if (!this.config || this.config.lastNotifiedKey === key) return false;
    this.claims += 1;
    this.config.lastNotifiedKey = key;
    return true;
  }
  async releaseNotification(key: string, previous: string | null) {
    if (this.config?.lastNotifiedKey === key) this.config.lastNotifiedKey = previous;
  }
  async getRules() {
    return [...this.rules];
  }
  async replaceRules(rules: ClassificationRule[]) {
    this.rules = rules.map((r, i) => ({ ...r, id: i + 1 }));
  }
}
