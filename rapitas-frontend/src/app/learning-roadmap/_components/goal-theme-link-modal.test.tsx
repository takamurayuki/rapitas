/**
 * goal-theme-link-modal.test.tsx
 *
 * Verifies initial selection, theme selection, and unlink ("紐づけなし")
 * save flows for GoalThemeLinkModal.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { GoalThemeLinkModal } from './goal-theme-link-modal';
import type { StudyGoal } from './roadmap.types';
import type { Theme } from '@/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
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
  themeId: 5,
  currentLevel: null,
  targetLevel: null,
  targetScore: null,
  actualScore: null,
  taskCount: 0,
  doneTaskCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const themes: Theme[] = [{ id: 5, name: 'テーマA' } as Theme, { id: 6, name: 'テーマB' } as Theme];

describe('GoalThemeLinkModal', () => {
  test('初期選択値がgoal.themeIdと一致すること', () => {
    render(
      <GoalThemeLinkModal goal={baseGoal} themes={themes} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('5');
  });

  test('紐づけなしを選択して保存するとonSave(id, null)が呼ばれること', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <GoalThemeLinkModal goal={baseGoal} themes={themes} onSave={onSave} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    fireEvent.click(screen.getByText('save'));
    expect(onSave).toHaveBeenCalledWith(1, null);
  });

  test('テーマを選択して保存するとonSave(id, themeId)が呼ばれること', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <GoalThemeLinkModal goal={baseGoal} themes={themes} onSave={onSave} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '6' } });
    fireEvent.click(screen.getByText('save'));
    expect(onSave).toHaveBeenCalledWith(1, 6);
  });
});
