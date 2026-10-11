/**
 * ThemeShareEditor tests
 *
 * Verifies manual share editing and saving, the >100% guard, that the 30-day
 * suggestion only pre-fills (never saves by itself), the link to the existing
 * theme page for renaming, and the unconfigured state.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeShareEditor } from './ThemeShareEditor';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
    params ? `${ns}.${key}:${JSON.stringify(params)}` : `${ns}.${key}`,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const themes = [
  { id: 1, name: 'Alpha' },
  { id: 2, name: 'Beta' },
];

function setup(onSave = vi.fn().mockResolvedValue(true)) {
  render(
    <ThemeShareEditor
      unit="tokens"
      shares={[{ themeId: 1, sharePercent: 60 }]}
      usage={[{ themeId: 1, themeName: 'Alpha', used: 10, sharePercent: 60, allocated: 600 }]}
      suggestions={[
        { themeId: 2, themeName: 'Beta', sharePercent: 70 },
        { themeId: 1, themeName: 'Alpha', sharePercent: 30 },
      ]}
      themes={themes}
      onSave={onSave}
    />,
  );
  return onSave;
}

describe('ThemeShareEditor', () => {
  it('adds a theme, edits shares and saves them', async () => {
    const onSave = setup();
    fireEvent.change(screen.getByLabelText('usageBudget.selectTheme'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('usageBudget.sharePercent 2'), {
      target: { value: '40' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'usageBudget.save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([
      { themeId: 1, sharePercent: 60 },
      { themeId: 2, sharePercent: 40 },
    ]);
  });

  it('blocks saving when the total exceeds 100%', () => {
    setup();
    fireEvent.change(screen.getByLabelText('usageBudget.sharePercent 1'), {
      target: { value: '101' },
    });
    expect(screen.getByText('usageBudget.shareTotalTooHigh')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'usageBudget.save' })).toBeDisabled();
  });

  it('applies the suggestion as starting values without saving', () => {
    const onSave = setup();
    fireEvent.click(screen.getByRole('button', { name: 'usageBudget.applySuggestion' }));
    expect((screen.getByLabelText('usageBudget.sharePercent 2') as HTMLInputElement).value).toBe(
      '70',
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the remaining unallocated share and the allocation', () => {
    setup();
    expect(screen.getByText(/usageBudget\.unallocated/)).toHaveTextContent('"percent":"40"');
    expect(screen.getByText(/usageBudget\.allocated/)).toBeInTheDocument();
  });

  it('links to the theme page for renaming themes', () => {
    setup();
    expect(screen.getByText('usageBudget.manageThemes').closest('a')).toHaveAttribute(
      'href',
      '/themes',
    );
  });

  it('asks for a budget first when none is configured', () => {
    render(
      <ThemeShareEditor
        unit={null}
        shares={[]}
        usage={[]}
        suggestions={[]}
        themes={themes}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText('usageBudget.notConfigured')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'usageBudget.save' })).toBeNull();
  });
});
