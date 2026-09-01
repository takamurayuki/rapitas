/**
 * goal-card.test.tsx
 *
 * Verifies the theme-link badge visibility and the "テーマを紐づけ" button
 * callback, in addition to the existing edit/complete/delete callbacks.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { StudyGoalCard } from './goal-card';
import type { StudyGoal } from './roadmap.types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useFormatter: () => ({
    dateTime: (d: Date) => d.toISOString(),
  }),
}));

const baseGoal: StudyGoal = {
  id: 1,
  type: 'skill',
  title: 'テスト目標',
  description: null,
  deadline: null,
  status: 'active',
  color: '#10B981',
  icon: null,
  dailyMinutes: 60,
  categoryId: null,
  themeId: null,
  currentLevel: null,
  targetLevel: null,
  targetScore: null,
  actualScore: null,
  taskCount: 0,
  doneTaskCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('StudyGoalCard', () => {
  test('linkedThemeNameがnullの場合バッジを表示しないこと', () => {
    render(
      <StudyGoalCard
        goal={baseGoal}
        onEdit={vi.fn()}
        onComplete={vi.fn()}
        onDelete={vi.fn()}
        linkedThemeName={null}
        onLinkTheme={vi.fn()}
      />,
    );
    expect(screen.queryByText(/themeLink\.linkedBadge/)).not.toBeInTheDocument();
  });

  test('linkedThemeNameが非nullの場合バッジを表示すること', () => {
    render(
      <StudyGoalCard
        goal={baseGoal}
        onEdit={vi.fn()}
        onComplete={vi.fn()}
        onDelete={vi.fn()}
        linkedThemeName="学習テーマ"
        onLinkTheme={vi.fn()}
      />,
    );
    expect(screen.getByText(/themeLink\.linkedBadge/)).toBeInTheDocument();
  });

  test('テーマ紐づけボタン押下でonLinkThemeが呼ばれること', () => {
    const onLinkTheme = vi.fn();
    render(
      <StudyGoalCard
        goal={baseGoal}
        onEdit={vi.fn()}
        onComplete={vi.fn()}
        onDelete={vi.fn()}
        linkedThemeName={null}
        onLinkTheme={onLinkTheme}
      />,
    );
    fireEvent.click(screen.getByLabelText('themeLink.button'));
    expect(onLinkTheme).toHaveBeenCalledWith(baseGoal);
  });
});
