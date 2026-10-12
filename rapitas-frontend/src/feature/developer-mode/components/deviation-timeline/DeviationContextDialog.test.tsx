/**
 * DeviationContextDialog tests — opening fetches the surrounding log lines
 * once and highlights the deviation's own line.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { DeviationContextDialog } from './DeviationContextDialog';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('DeviationContextDialog', () => {
  test('fetches context with the seq once and marks the target line', async () => {
    const fetchContext = vi.fn().mockResolvedValue([
      { sequenceNumber: 6, text: 'before line', isTarget: false },
      { sequenceNumber: 7, text: '[Tool: Bash] rm -rf x', isTarget: true },
      { sequenceNumber: 8, text: 'after line', isTarget: false },
    ]);
    render(
      <DeviationContextDialog
        open
        executionId={9}
        seq={7}
        fetchContext={fetchContext}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('before line')).toBeInTheDocument());
    expect(fetchContext).toHaveBeenCalledTimes(1);
    expect(fetchContext).toHaveBeenCalledWith(9, 7);
    const target = screen.getByText('[Tool: Bash] rm -rf x').closest('[data-target]');
    expect(target?.getAttribute('data-target')).toBe('true');
    expect(screen.getByText('after line')).toBeInTheDocument();
  });

  test('shows an error message when fetching fails', async () => {
    const fetchContext = vi.fn().mockRejectedValue(new Error('HTTP 500'));
    render(
      <DeviationContextDialog
        open
        executionId={9}
        seq={7}
        fetchContext={fetchContext}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('contextError')).toBeInTheDocument());
  });

  test('closed dialog renders nothing and does not fetch', () => {
    const fetchContext = vi.fn();
    const { container } = render(
      <DeviationContextDialog
        open={false}
        executionId={9}
        seq={7}
        fetchContext={fetchContext}
        onClose={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(fetchContext).not.toHaveBeenCalled();
  });
});
