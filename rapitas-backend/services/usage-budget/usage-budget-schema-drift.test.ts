/**
 * usage-budget-schema-drift test
 *
 * `UsageBudgetDb` is bound to the Prisma client through an `unknown` cast (the
 * generated client lags until a server restart), so the compiler cannot catch
 * a model/field rename. This pins every model and field the feature uses
 * against prisma/schema/usage-budget.prisma and its generated desktop copy.
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PRISMA_DIR = path.join(import.meta.dir, '..', '..', 'prisma');

const EXPECTED: Record<string, string[]> = {
  UsageBudget: [
    'id',
    'unit',
    'monthlyLimit',
    'snoozedUntil',
    'acknowledgedKey',
    'lastNotifiedKey',
    'createdAt',
    'updatedAt',
  ],
  UsageBudgetThemeShare: ['id', 'budgetId', 'themeId', 'sharePercent'],
  UsageClassificationRule: ['id', 'themeId', 'keyword', 'sortOrder', 'enabled', 'createdAt'],
};

function modelBody(schema: string, model: string): string {
  const m = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`));
  return m ? m[1] : '';
}

describe.each(['schema', 'schema.desktop'])('usage-budget.prisma in %s', (dir) => {
  const schema = readFileSync(path.join(PRISMA_DIR, dir, 'usage-budget.prisma'), 'utf8');
  for (const [model, fields] of Object.entries(EXPECTED)) {
    it(`declares ${model} with every field the store uses`, () => {
      const body = modelBody(schema, model);
      expect(body.length).toBeGreaterThan(0);
      for (const field of fields) {
        expect(body).toMatch(new RegExp(`^\\s*${field}\\s`, 'm'));
      }
    });
  }

  it('keeps (budgetId, themeId) unique so a theme has one share', () => {
    expect(modelBody(schema, 'UsageBudgetThemeShare')).toContain('@@unique([budgetId, themeId])');
  });
});
