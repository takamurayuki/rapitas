/**
 * id-param-migration-baseline.test.mjs
 *
 * Keeps the require-validated-id-param ratchet honest in both directions.
 *
 * A list of exempt files is the kind of gate that quietly stops measuring: a
 * file gets fixed, the entry stays, and from then on that file is unprotected
 * for free. So every entry has to still violate the rule, and every entry has
 * to still exist. The only way to satisfy this test after fixing a file is to
 * delete its line (see docs/lessons/gates-that-do-not-measure.md).
 *
 * The rule's own behaviour is tested in require-validated-id-param.test.mjs.
 * This file tests the LIST.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync } from 'fs';
import { ESLint } from 'eslint';
import tsparser from '@typescript-eslint/parser';
import rule from './require-validated-id-param.mjs';
import { ID_PARAM_MIGRATION_BASELINE } from './id-param-migration-baseline.mjs';

const RULE_ID = 'local/require-validated-id-param';

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.ts'],
      languageOptions: {
        parser: tsparser,
        parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      },
      plugins: { local: { rules: { 'require-validated-id-param': rule } } },
      rules: { [RULE_ID]: 'error' },
    },
  ],
});

const present = ID_PARAM_MIGRATION_BASELINE.filter((file) => existsSync(file));
// One lint pass for the whole list; 37 separate passes would make this the
// slowest test in the suite for no extra signal.
const results = present.length > 0 ? await eslint.lintFiles(present) : [];

/** Violation count per baseline-relative path. */
const counts = new Map(
  results.map((result) => [
    result.filePath.replaceAll('\\', '/').split('rapitas-backend/').pop(),
    result.messages.filter((message) => message.ruleId === RULE_ID).length,
  ]),
);

describe('id-param migration baseline', () => {
  it('lists only files that exist', () => {
    const missing = ID_PARAM_MIGRATION_BASELINE.filter((file) => !existsSync(file));
    expect(missing).toEqual([]);
  });

  it('holds no duplicate entries', () => {
    expect([...new Set(ID_PARAM_MIGRATION_BASELINE)].length).toBe(
      ID_PARAM_MIGRATION_BASELINE.length,
    );
  });

  it('exempts only route files — nothing else should need this', () => {
    const strays = ID_PARAM_MIGRATION_BASELINE.filter((file) => !file.startsWith('routes/'));
    expect(strays).toEqual([]);
  });

  it('shrinks only: every entry still violates the rule', () => {
    // An entry with 0 violations has been fixed — delete the line.
    const fixed = present.filter((file) => (counts.get(file) ?? 0) === 0);
    expect(fixed).toEqual([]);
  });

  it('still proves the rule can fail — the exemptions are real violations', () => {
    // If this total ever reads 0, the rule has stopped matching anything and
    // every "clean" lint run below it means nothing.
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThan(0);
  });
});
