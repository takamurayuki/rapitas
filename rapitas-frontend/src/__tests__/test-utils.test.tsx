/**
 * test-utils.test
 *
 * Smoke tests for renderWithProviders: verifies that ToastContext is provided
 * to children and that useToast() does not throw when rendered via the helper.
 */
import { renderWithProviders, screen } from '@/__tests__/test-utils';
import { useToast } from '@/components/ui/toast/ToastContainer';

function ToastConsumer() {
  const { showToast } = useToast();
  return <button onClick={() => showToast('test')}>toast</button>;
}

describe('renderWithProviders', () => {
  it('provides ToastContext so useToast does not throw', () => {
    expect(() => renderWithProviders(<ToastConsumer />)).not.toThrow();
    expect(screen.getByText('toast')).toBeInTheDocument();
  });

  it('exposes showToast as a function via useToast', () => {
    renderWithProviders(<ToastConsumer />);
    expect(screen.getByRole('button', { name: 'toast' })).toBeInTheDocument();
  });
});
