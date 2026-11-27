/**
 * workflow-role-prompts — プランナー指示に計画の大きさの目安と
 * 後続タスクへの切り出し指示（parentId なし）が含まれることを検証する。
 */
import { describe, expect, test } from 'bun:test';
import { buildRoleTexts } from './workflow-role-prompts';
import { PLAN_MAX_CHANGED_FILES, PLAN_MAX_CHECKLIST_ITEMS } from './plan-size-policy';

const UNIQUE = {
  ja: 'parentId を付けない通常のタスク',
  en: 'ordinary task without parentId',
} as const;

describe('planner plan-size guidance (task 1540)', () => {
  for (const lang of ['ja', 'en'] as const) {
    test(`${lang}: 目安値と切り出し指示を含む`, () => {
      const text = buildRoleTexts(1540, { title: 'Probe', description: null }, lang).planner
        .instruction;
      expect(text).toContain(String(PLAN_MAX_CHECKLIST_ITEMS));
      expect(text).toContain(String(PLAN_MAX_CHANGED_FILES));
      expect(text).toContain('POST /tasks');
    });

    test(`${lang}: parentId を付けない固有の文言を含む`, () => {
      const text = buildRoleTexts(1540, { title: 'Probe', description: null }, lang).planner
        .instruction;
      expect(text).toContain(UNIQUE[lang]);
    });
  }
});
