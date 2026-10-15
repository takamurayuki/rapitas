/**
 * workflow-role-prompts — planner is told to emit the machine-readable
 * json:plan-declaration fence (task 1218), in both languages.
 */
import { describe, expect, test } from 'bun:test';
import { buildRoleTexts } from './workflow-role-prompts';
import { parsePlanDeclaration } from './plan-deviation/declaration-parser';

describe('planner plan-declaration guidance (task 1218)', () => {
  for (const lang of ['ja', 'en'] as const) {
    test(`${lang} planner instruction asks for the json:plan-declaration fence`, () => {
      const texts = buildRoleTexts(1218, { title: 'Probe', description: null }, lang);
      expect(texts.planner.instruction).toContain('```json:plan-declaration');
      expect(texts.planner.instruction).toContain('"externalHosts"');
    });

    test(`${lang} example fence in the instruction parses as a non-ambiguous declaration`, () => {
      const texts = buildRoleTexts(1218, { title: 'Probe', description: null }, lang);
      const parsed = parsePlanDeclaration(texts.planner.instruction);
      expect(parsed.source).toBe('fence');
      expect(parsed.ambiguous).toBe(false);
    });
  }
});
