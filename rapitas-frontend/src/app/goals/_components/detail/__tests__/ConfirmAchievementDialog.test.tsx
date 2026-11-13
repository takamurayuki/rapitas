/**
 * ConfirmAchievementDialog.test
 *
 * The person confirms a milestone by ticking every agreed criterion and
 * writing why. The confirm button stays off until both are done, and what is
 * sent is exactly the ticked criteria and the evidence.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { ConfirmAchievementDialog } from '../ConfirmAchievementDialog';

const milestone = {
  id: 3,
  name: '基礎固め',
  acceptanceCriteria: ['模試で7割', '過去問3年分'],
};

describe('ConfirmAchievementDialog', () => {
  it('keeps confirm off until every criterion is ticked and the evidence is written', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmAchievementDialog milestone={milestone} onConfirm={onConfirm} onClose={vi.fn()} />,
    );
    const confirm = screen.getByRole('button', { name: 'confirm.submit' });
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: '模試で7割' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '過去問3年分' }));
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('confirm.evidenceLabel'), {
      target: { value: '   ' },
    });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('confirm.evidenceLabel'), {
      target: { value: '11/10 の模試で 74%' },
    });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith(['模試で7割', '過去問3年分'], '11/10 の模試で 74%');
  });

  it('stays off when one criterion is unticked again', () => {
    render(
      <ConfirmAchievementDialog milestone={milestone} onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: '模試で7割' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '過去問3年分' }));
    fireEvent.change(screen.getByLabelText('confirm.evidenceLabel'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '模試で7割' }));
    expect(screen.getByRole('button', { name: 'confirm.submit' })).toBeDisabled();
  });

  it('shows the error it is given (e.g. the backend refused)', () => {
    render(
      <ConfirmAchievementDialog
        milestone={milestone}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        error="達成条件が変わりました"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('達成条件が変わりました');
  });
});
