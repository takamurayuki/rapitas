/**
 * BudgetSettingsForm tests
 *
 * Verifies the unit/limit are sent on save, an invalid limit disables saving,
 * and a failed save shows an error while keeping the typed values.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BudgetSettingsForm } from './BudgetSettingsForm';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

describe('BudgetSettingsForm', () => {
  it('saves the unit and the monthly limit', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(<BudgetSettingsForm unit={null} monthlyLimit={null} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('usageBudget.unit'), {
      target: { value: 'executions' },
    });
    fireEvent.change(screen.getByLabelText('usageBudget.monthlyLimit'), {
      target: { value: '300' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'usageBudget.save' }));
    await waitFor(() => expect(screen.getByText('usageBudget.saved')).toBeInTheDocument());
    expect(onSave).toHaveBeenCalledWith('executions', 300);
  });

  it('disables saving for a non-positive or fractional limit', () => {
    render(<BudgetSettingsForm unit="tokens" monthlyLimit={100} onSave={vi.fn()} />);
    const input = screen.getByLabelText('usageBudget.monthlyLimit');
    const button = screen.getByRole('button', { name: 'usageBudget.save' });
    expect(button).toBeEnabled();
    fireEvent.change(input, { target: { value: '0' } });
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: '1.5' } });
    expect(button).toBeDisabled();
    expect(screen.getByText('usageBudget.limitInvalid')).toBeInTheDocument();
  });

  it('keeps the typed values and shows an error when saving fails', async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    render(<BudgetSettingsForm unit="tokens" monthlyLimit={100} onSave={onSave} />);
    const input = screen.getByLabelText('usageBudget.monthlyLimit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'usageBudget.save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('usageBudget.saveFailed');
    expect(input.value).toBe('5000');
  });
});
