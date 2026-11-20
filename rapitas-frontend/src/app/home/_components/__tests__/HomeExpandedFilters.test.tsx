import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { Task } from '@/types';
import { useTaskSorting } from '@/hooks/task/useTaskSorting';
import { useHomeState } from '../../_hooks/useHomeState';
import { HomeExpandedFilters } from '../HomeExpandedFilters';
import jaHome from '../../../../../messages/fragments/ja/04-home.json';
import enHome from '../../../../../messages/fragments/en/04-home.json';
import jaTask from '../../../../../messages/fragments/ja/05-task.json';
import enTask from '../../../../../messages/fragments/en/05-task.json';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const tasks: Task[] = [
  { id: 1, title: '期限なし（null）', dueDate: null },
  { id: 2, title: '近い期限', dueDate: '2026-11-21T00:00:00.000Z' },
  { id: 3, title: '期限なし（未設定）', dueDate: undefined },
  { id: 4, title: '遠い期限', dueDate: '2026-11-30T00:00:00.000Z' },
].map((task) => ({
  ...task,
  status: 'todo',
  priority: 'medium',
  labels: [],
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
}));

// NOTE: 翻訳・選択UI・ホームの状態・ソートを実装のまま接続し、モックで欠落を隠さない。
function SortingHarness() {
  const state = useHomeState();
  const sorted = useTaskSorting({ tasks, sortBy: state.sortBy, sortOrder: state.sortOrder });

  return (
    <>
      <HomeExpandedFilters
        filter={state.filter}
        priorityFilter={state.priorityFilter}
        labels={[]}
        labelFilter={state.labelFilter}
        sortBy={state.sortBy}
        sortOrder={state.sortOrder}
        isFilterExpanded
        statusCounts={{ all: tasks.length }}
        onFilterChange={state.setFilter}
        onPriorityChange={state.setPriorityFilter}
        onLabelChange={state.setLabelFilter}
        onSortByChange={state.setSortBy}
        onSortOrderToggle={() => state.setSortOrder((order) => (order === 'asc' ? 'desc' : 'asc'))}
      />
      <ol>
        {sorted.map((task) => (
          <li key={task.id}>{task.title}</li>
        ))}
      </ol>
    </>
  );
}

describe('ホームの期限ソート', () => {
  it.each([
    { locale: 'ja', messages: { ...jaHome, ...jaTask }, label: '期限' },
    { locale: 'en', messages: { ...enHome, ...enTask }, label: 'Due date' },
  ])(
    '$locale の期限ラベルを選び、両方向で期限なしを末尾に並べる',
    ({ locale, messages, label }) => {
      render(
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Tokyo">
          <SortingHarness />
        </NextIntlClientProvider>,
      );

      const option = screen.getByRole('option', { name: label });
      expect(option).toHaveValue('dueDate');
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'dueDate' } });
      expect(select).toHaveValue('dueDate');

      const titles = () => screen.getAllByRole('listitem').map((item) => item.textContent);
      const undated = ['期限なし（null）', '期限なし（未設定）'];
      expect(titles()).toEqual(['遠い期限', '近い期限', ...undated]);

      fireEvent.click(screen.getByTitle('DESC'));
      expect(titles()).toEqual(['近い期限', '遠い期限', ...undated]);

      fireEvent.click(screen.getByTitle('ASC'));
      expect(titles()).toEqual(['遠い期限', '近い期限', ...undated]);
    },
  );
});
