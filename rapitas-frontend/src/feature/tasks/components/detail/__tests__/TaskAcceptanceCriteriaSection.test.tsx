/**
 * TaskAcceptanceCriteriaSection
 *
 * The desktop task detail shows the task's completion criteria, keeping the
 * jury-checked list (acceptanceCriteria) apart from the person-checked list
 * (userAcceptanceChecks) the same way the mobile detail does, and renders
 * nothing at all when the task has no criteria.
 */
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ja from '../../../../../../messages/ja.json';
import { Accordion } from '@/components/ui/accordion/Accordion';
import TaskAcceptanceCriteriaSection from '../TaskAcceptanceCriteriaSection';
import { parseCriteriaList } from '../task-criteria.utils';

function renderSection(task: {
  acceptanceCriteria?: string | null;
  userAcceptanceChecks?: string | null;
}) {
  return render(
    <NextIntlClientProvider locale="ja" messages={ja}>
      <Accordion defaultExpanded={['criteria']} allowMultiple>
        <TaskAcceptanceCriteriaSection task={task} />
      </Accordion>
    </NextIntlClientProvider>,
  );
}

describe('parseCriteriaList', () => {
  it('reads the DB JSON-string form and trims / drops blanks', () => {
    expect(parseCriteriaList('["  a ", "", "b"]')).toEqual(['a', 'b']);
  });

  it('accepts an array as-is', () => {
    expect(parseCriteriaList(['x', 'y'])).toEqual(['x', 'y']);
  });

  it('returns [] for null, empty, broken JSON or non-arrays', () => {
    expect(parseCriteriaList(null)).toEqual([]);
    expect(parseCriteriaList(undefined)).toEqual([]);
    expect(parseCriteriaList('  ')).toEqual([]);
    expect(parseCriteriaList('{not json')).toEqual([]);
    expect(parseCriteriaList('{"a":1}')).toEqual([]);
    expect(parseCriteriaList('[1, "ok"]')).toEqual(['ok']);
  });
});

describe('TaskAcceptanceCriteriaSection', () => {
  it('renders nothing when the task has no criteria', () => {
    const { container } = renderSection({ acceptanceCriteria: null, userAcceptanceChecks: '[]' });
    expect(container.textContent).toBe('');
  });

  it('shows the jury criteria without subheadings when there are no person checks', () => {
    renderSection({ acceptanceCriteria: '["テストが通る","型チェックが通る"]' });
    expect(screen.getByRole('button', { name: /完了条件/ })).toBeInTheDocument();
    const list = screen.getByTestId('task-criteria-jury-list');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['1.テストが通る', '2.型チェックが通る']);
    expect(screen.queryByText('陪審が確かめる')).not.toBeInTheDocument();
    expect(screen.queryByText('本人が確かめる')).not.toBeInTheDocument();
  });

  it('separates jury criteria from person checks when both exist', () => {
    renderSection({
      acceptanceCriteria: '["テストが通る"]',
      userAcceptanceChecks: '["実機で見た目に違和感がない"]',
    });
    expect(screen.getByText('陪審が確かめる')).toBeInTheDocument();
    expect(screen.getByText('本人が確かめる')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('task-criteria-jury-list')).getByText('テストが通る'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('task-criteria-user-list')).getByText('実機で見た目に違和感がない'),
    ).toBeInTheDocument();
  });

  it('explains an empty jury list when only person checks exist', () => {
    renderSection({ acceptanceCriteria: '[]', userAcceptanceChecks: '["触って確かめる"]' });
    expect(screen.queryByTestId('task-criteria-jury-list')).not.toBeInTheDocument();
    expect(
      screen.getByText('ありません（本人が確かめる条件だけのタスクです）。'),
    ).toBeInTheDocument();
    expect(screen.getByText('触って確かめる')).toBeInTheDocument();
  });
});
