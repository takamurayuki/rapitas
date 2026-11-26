/**
 * AutoRunConcurrencyField.test
 *
 * Task 1552: the per-theme concurrency row sits under the global one, saves its
 * own key (autoRunMaxConcurrencyPerTheme), clamps to 1..4 and is disabled while
 * AUTO_RUN_THEME_MAX_CONCURRENCY overrides it. The global row is unchanged.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { AutoRunConcurrencyField } from './AutoRunConcurrencyField';
import type { UserSettings } from '@/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

function renderField(overrides: Partial<UserSettings> = {}, onUpdateSettings = vi.fn()) {
  render(
    <AutoRunConcurrencyField
      settings={{ id: 1, ...overrides } as UserSettings}
      isSaving={false}
      onUpdateSettings={onUpdateSettings}
    />,
  );
  return onUpdateSettings;
}

describe('AutoRunConcurrencyField — per-theme limit (task 1552)', () => {
  it('defaults to 1 when the server has not migrated the column yet', () => {
    renderField({ autoRunMaxConcurrency: 2 });
    expect((screen.getByLabelText('maxConcurrencyPerThemeLabel') as HTMLInputElement).value).toBe(
      '1',
    );
  });

  it('commits its own key on blur, clamped to 1..4', () => {
    const onUpdateSettings = renderField({ autoRunMaxConcurrencyPerTheme: 1 });
    const input = screen.getByLabelText('maxConcurrencyPerThemeLabel');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input);
    expect(onUpdateSettings).toHaveBeenLastCalledWith({ autoRunMaxConcurrencyPerTheme: 2 });
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.blur(input);
    expect(onUpdateSettings).toHaveBeenLastCalledWith({ autoRunMaxConcurrencyPerTheme: 4 });
  });

  it('is disabled with a note while the env var wins; the global row stays editable', () => {
    renderField({ autoRunMaxConcurrencyPerTheme: 1, autoRunMaxConcurrencyPerThemeEnvOverride: 2 });
    expect(screen.getByText('maxConcurrencyPerThemeEnvOverride')).toBeTruthy();
    expect(
      (screen.getByLabelText('maxConcurrencyPerThemeLabel') as HTMLInputElement).disabled,
    ).toBe(true);
    expect((screen.getByLabelText('maxConcurrencyLabel') as HTMLInputElement).disabled).toBe(false);
  });
});
