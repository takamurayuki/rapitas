/**
 * AutoRunSettingsCard.test
 *
 * Covers the idle-stop timer / nightly self-refill window fields (task 784):
 * each edit is committed to onUpdateSettings (the /settings PATCH payload)
 * with the exact key the backend persists, disabling works (0 minutes / empty
 * window), and unchanged values are not re-sent.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { AutoRunSettingsCard } from './AutoRunSettingsCard';
import type { UserSettings } from '@/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const BASE_SETTINGS: UserSettings = {
  id: 1,
  aiTaskAnalysisDefault: false,
  autoResumeInterruptedTasks: false,
  autoExecuteAfterCreate: false,
  autoGenerateTitle: false,
  autoGenerateTitleDelay: 3,
  autoCreateAfterTitleGeneration: false,
  autoFetchTaskSuggestions: true,
  autoApprovePlan: false,
  autoApproveSubtaskPlan: true,
  autoComplexityAnalysis: false,
  activeMode: 'both',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  idleStopMinutes: 60,
  selfRefillWindowStart: '03:00',
};

function renderCard(overrides: Partial<UserSettings> = {}, onUpdateSettings = vi.fn()) {
  render(
    <AutoRunSettingsCard
      settings={{ ...BASE_SETTINGS, ...overrides }}
      isSaving={false}
      onUpdateSettings={onUpdateSettings}
    />,
  );
  return onUpdateSettings;
}

describe('AutoRunSettingsCard — idle-stop timer', () => {
  it('renders the idle-stop and self-refill window fields with their server values', () => {
    renderCard();
    expect(screen.getByText('idleStopLabel')).toBeTruthy();
    expect(screen.getByText('selfRefillWindowLabel')).toBeTruthy();
    expect((screen.getByLabelText('idleStopLabel') as HTMLInputElement).value).toBe('60');
    expect((screen.getByLabelText('selfRefillWindowLabel') as HTMLInputElement).value).toBe(
      '03:00',
    );
  });

  it('commits a changed idleStopMinutes on blur as the PATCH payload key', () => {
    const onUpdateSettings = renderCard();
    const input = screen.getByLabelText('idleStopLabel');
    fireEvent.change(input, { target: { value: '90' } });
    fireEvent.blur(input);
    expect(onUpdateSettings).toHaveBeenCalledWith({ idleStopMinutes: 90 });
  });

  it('disables the timer with 0 and clamps out-of-range values', () => {
    const onUpdateSettings = renderCard();
    const input = screen.getByLabelText('idleStopLabel');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(onUpdateSettings).toHaveBeenCalledWith({ idleStopMinutes: 0 });

    fireEvent.change(input, { target: { value: '99999' } });
    fireEvent.blur(input);
    expect(onUpdateSettings).toHaveBeenLastCalledWith({ idleStopMinutes: 1440 });
  });

  it('does not re-send an unchanged idleStopMinutes', () => {
    const onUpdateSettings = renderCard();
    const input = screen.getByLabelText('idleStopLabel');
    fireEvent.blur(input);
    expect(onUpdateSettings).not.toHaveBeenCalled();
  });

  it('falls back to the defaults when the server has not migrated the columns yet', () => {
    renderCard({ idleStopMinutes: undefined, selfRefillWindowStart: undefined });
    expect((screen.getByLabelText('idleStopLabel') as HTMLInputElement).value).toBe('60');
    expect((screen.getByLabelText('selfRefillWindowLabel') as HTMLInputElement).value).toBe(
      '03:00',
    );
  });
});

describe('AutoRunSettingsCard — nightly self-refill window', () => {
  it('commits a changed window start time on blur', () => {
    const onUpdateSettings = renderCard();
    const input = screen.getByLabelText('selfRefillWindowLabel');
    fireEvent.change(input, { target: { value: '04:30' } });
    fireEvent.blur(input);
    expect(onUpdateSettings).toHaveBeenCalledWith({ selfRefillWindowStart: '04:30' });
  });

  it('disables self-refill via the disable button (empty string)', () => {
    const onUpdateSettings = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'selfRefillWindowDisable' }));
    expect(onUpdateSettings).toHaveBeenCalledWith({ selfRefillWindowStart: '' });
  });

  it('shows the disabled state and hides the disable button when the window is off', () => {
    renderCard({ selfRefillWindowStart: '' });
    expect(screen.getByText('selfRefillWindowDisabled')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'selfRefillWindowDisable' })).toBeNull();
    expect((screen.getByLabelText('selfRefillWindowLabel') as HTMLInputElement).value).toBe('');
  });

  it('re-enables self-refill by entering a time while disabled', () => {
    const onUpdateSettings = renderCard({ selfRefillWindowStart: '' });
    const input = screen.getByLabelText('selfRefillWindowLabel');
    fireEvent.change(input, { target: { value: '02:15' } });
    fireEvent.blur(input);
    expect(onUpdateSettings).toHaveBeenCalledWith({ selfRefillWindowStart: '02:15' });
  });
});

describe('AutoRunSettingsCard — auto-run concurrency (task 1543)', () => {
  it('shows the saved value and commits a changed value on blur', () => {
    const onUpdateSettings = renderCard({ autoRunMaxConcurrency: 1 });
    const input = screen.getByLabelText('maxConcurrencyLabel') as HTMLInputElement;
    expect(input.value).toBe('1');
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.blur(input);
    expect(onUpdateSettings).toHaveBeenCalledWith({ autoRunMaxConcurrency: 3 });
  });

  it('clamps out-of-range values to 1..4 and treats empty as 1', () => {
    const onUpdateSettings = renderCard({ autoRunMaxConcurrency: 2 });
    const input = screen.getByLabelText('maxConcurrencyLabel');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.blur(input);
    expect(onUpdateSettings).toHaveBeenLastCalledWith({ autoRunMaxConcurrency: 4 });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onUpdateSettings).toHaveBeenLastCalledWith({ autoRunMaxConcurrency: 1 });
  });

  it('does not re-send an unchanged value', () => {
    const onUpdateSettings = renderCard({ autoRunMaxConcurrency: 2 });
    const input = screen.getByLabelText('maxConcurrencyLabel');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input);
    expect(onUpdateSettings).not.toHaveBeenCalled();
  });

  it('shows the env override note and disables the input while the env var wins', () => {
    renderCard({ autoRunMaxConcurrency: 1, autoRunMaxConcurrencyEnvOverride: 2 });
    expect(screen.getByText('maxConcurrencyEnvOverride')).toBeTruthy();
    expect((screen.getByLabelText('maxConcurrencyLabel') as HTMLInputElement).disabled).toBe(true);
  });

  it('keeps the input enabled without an env override', () => {
    renderCard({ autoRunMaxConcurrency: 1, autoRunMaxConcurrencyEnvOverride: null });
    expect(screen.queryByText('maxConcurrencyEnvOverride')).toBeNull();
    expect((screen.getByLabelText('maxConcurrencyLabel') as HTMLInputElement).disabled).toBe(false);
  });
});
