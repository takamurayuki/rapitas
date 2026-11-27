/**
 * fake-theme-auto-run.test-support
 *
 * In-memory ThemeAutoRun table for the task-1552 parallel tests: findFirst /
 * findMany / updateMany with the compare-and-set conditions theme-active-set
 * writes (themeId, currentTaskId, companionTasksJson, status). Test-only.
 */
export interface FakeRow {
  themeId: number;
  status: string;
  currentTaskId: number | null;
  companionTasksJson: string | null;
  processedCount: number;
  lastRunAt: Date | null;
  lastError: string | null;
  enabled?: boolean;
  order?: string;
}

type Where = Record<string, unknown>;

function matches(row: FakeRow, where: Where): boolean {
  for (const [key, cond] of Object.entries(where)) {
    const value = (row as unknown as Record<string, unknown>)[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; not?: unknown; contains?: string };
      if (c.in && !c.in.includes(value)) return false;
      if ('not' in c && value === c.not) return false;
      if (c.contains !== undefined && !(typeof value === 'string' && value.includes(c.contains))) {
        return false;
      }
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}

/**
 * Build a fake themeAutoRun model over `rows` (mutated in place).
 *
 * @param rows - Table rows / 行
 * @returns Model plus a record of writes / モデルと書き込み記録
 */
export function fakeThemeAutoRun(rows: FakeRow[]) {
  const writes: Array<{ where: Where; data: Record<string, unknown> }> = [];
  return {
    writes,
    model: {
      findFirst: async (args: { where: Where }) => rows.find((r) => matches(r, args.where)) ?? null,
      findMany: async (args: { where?: Where } = {}) =>
        rows.filter((r) => matches(r, args.where ?? {})),
      updateMany: async (args: { where: Where; data: Record<string, unknown> }) => {
        writes.push(args);
        let count = 0;
        for (const r of rows) {
          if (!matches(r, args.where)) continue;
          count++;
          for (const [k, v] of Object.entries(args.data)) {
            if (k === 'processedCount' && v && typeof v === 'object') {
              r.processedCount += (v as { increment: number }).increment;
            } else {
              (r as unknown as Record<string, unknown>)[k] = v;
            }
          }
        }
        return { count };
      },
    },
  };
}

/**
 * A running theme row with sensible defaults.
 *
 * @param over - Field overrides / 上書き
 * @returns Row / 行
 */
export function runningRow(over: Partial<FakeRow> = {}): FakeRow {
  return {
    themeId: 1,
    status: 'running',
    currentTaskId: null,
    companionTasksJson: null,
    processedCount: 0,
    lastRunAt: null,
    lastError: null,
    enabled: true,
    order: 'priority',
    ...over,
  };
}
