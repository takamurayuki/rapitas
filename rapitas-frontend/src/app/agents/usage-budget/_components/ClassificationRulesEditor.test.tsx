/**
 * ClassificationRulesEditor tests
 *
 * Verifies adding a rule, reordering (list order = priority = sortOrder),
 * the incomplete-rule guard, toggling, and the save failure message.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ClassificationRulesEditor } from './ClassificationRulesEditor';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

const themes = [
  { id: 1, name: 'Alpha' },
  { id: 2, name: 'Beta' },
];
const rules = [{ id: 9, themeId: 1, keyword: 'login', sortOrder: 0, enabled: true }];

describe('ClassificationRulesEditor', () => {
  it('adds a rule, moves it to the top and saves with sortOrder by position', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(<ClassificationRulesEditor rules={rules} themes={themes} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'usageBudget.addRule' }));
    fireEvent.change(screen.getByLabelText('usageBudget.keyword 2'), {
      target: { value: ' billing ' },
    });
    fireEvent.change(screen.getByLabelText('usageBudget.targetTheme 2'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'usageBudget.moveUp 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'usageBudget.save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([
      { keyword: 'billing', themeId: 2, enabled: true, sortOrder: 0 },
      { keyword: 'login', themeId: 1, enabled: true, sortOrder: 1 },
    ]);
  });

  it('blocks saving while a rule lacks a keyword or theme', () => {
    render(<ClassificationRulesEditor rules={[]} themes={themes} onSave={vi.fn()} />);
    expect(screen.getByText('usageBudget.noRules')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'usageBudget.addRule' }));
    expect(screen.getByText('usageBudget.ruleInvalid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'usageBudget.save' })).toBeDisabled();
  });

  it('can disable and remove rules', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <ClassificationRulesEditor
        rules={[...rules, { id: 10, themeId: 2, keyword: 'ui', sortOrder: 1, enabled: true }]}
        themes={themes}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'usageBudget.remove 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'usageBudget.save' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith([
        { keyword: 'ui', themeId: 2, enabled: false, sortOrder: 0 },
      ]),
    );
  });

  it('shows an error when saving fails', async () => {
    render(
      <ClassificationRulesEditor
        rules={rules}
        themes={themes}
        onSave={vi.fn().mockResolvedValue(false)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'usageBudget.save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('usageBudget.saveFailed');
  });
});
