/**
 * quick-nav-sections.test
 *
 * The header chips are a claim about another file: each id must be one
 * `TaskDetailViewBody` renders, under the same conditions. The chip that used
 * to say "AI" pointed at the assistant chat, which has moved into ラピ, so it
 * now points at the execution card — and that card is conditional, which the
 * chat never was.
 */
import { describe, it, expect } from 'vitest';
import { buildQuickNavSections } from '../quick-nav-sections';

const labels = {
  detail: '詳細',
  execution: 'エージェント実行',
  workflow: 'ワークフロー',
  subtasks: 'サブタスク',
};

const ids = (opts: { showExecutionSection: boolean; isDevelopmentTheme: boolean }) =>
  buildQuickNavSections({ ...opts, labels }).map((s) => s.id);

describe('the header chips', () => {
  // The chat is gone, so nothing may point at its anchor any more.
  it('no longer offers the assistant chat', () => {
    for (const showExecutionSection of [true, false]) {
      for (const isDevelopmentTheme of [true, false]) {
        expect(ids({ showExecutionSection, isDevelopmentTheme })).not.toContain('td-ai');
      }
    }
  });

  it('points at the execution card, with that card’s own label', () => {
    const chips = buildQuickNavSections({
      showExecutionSection: true,
      isDevelopmentTheme: true,
      labels,
    });
    const execution = chips.find((c) => c.id === 'td-execution');
    expect(execution).toBeDefined();
    expect(execution?.label).toBe('エージェント実行');
  });

  // A chip that scrolls nowhere is worse than no chip: the execution card is
  // not rendered without a working directory.
  it('drops the chip when there is no execution card to jump to', () => {
    expect(ids({ showExecutionSection: false, isDevelopmentTheme: true })).not.toContain(
      'td-execution',
    );
  });

  it('keeps the workflow chip tied to a development theme', () => {
    expect(ids({ showExecutionSection: true, isDevelopmentTheme: true })).toContain('td-workflow');
    expect(ids({ showExecutionSection: true, isDevelopmentTheme: false })).not.toContain(
      'td-workflow',
    );
  });

  // Order is the page's order; chips that jump about out of sequence read as
  // unrelated buttons.
  it('lists the sections in the order the page renders them', () => {
    expect(ids({ showExecutionSection: true, isDevelopmentTheme: true })).toEqual([
      'td-info',
      'td-execution',
      'td-workflow',
      'td-subtasks',
    ]);
  });

  it('always offers the detail and the subtasks', () => {
    expect(ids({ showExecutionSection: false, isDevelopmentTheme: false })).toEqual([
      'td-info',
      'td-subtasks',
    ]);
  });

  it('gives every chip a label and an icon', () => {
    for (const chip of buildQuickNavSections({
      showExecutionSection: true,
      isDevelopmentTheme: true,
      labels,
    })) {
      expect(chip.label.length).toBeGreaterThan(0);
      expect(chip.icon).toBeTruthy();
    }
  });
});
