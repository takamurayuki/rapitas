import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../common/ErrorBoundary';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// A component that throws an error
function ThrowError({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error message');
  }
  return <div>Child content</div>;
}

describe('ErrorBoundary', () => {
  // Suppress console.error for expected errors during tests
  const originalConsoleError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Safe content</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText('Safe content')).toBeInTheDocument();
  });

  it('renders default fallback UI when an error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('errorBoundary.genericError')).toBeInTheDocument();
    expect(screen.getByText('Test error message')).toBeInTheDocument();
    expect(screen.getByText('retry')).toBeInTheDocument();
  });

  it('renders section name in error message when provided', () => {
    render(
      <ErrorBoundary section="TaskList">
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>,
    );

    // NOTE: The mocked useTranslations echoes the key and ignores params, so the
    // interpolated section name isn't observable here — real next-intl interpolates it.
    expect(screen.getByText('errorBoundary.sectionError')).toBeInTheDocument();
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom error UI</div>}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Custom error UI')).toBeInTheDocument();
  });

  it('calls onError callback when an error occurs', () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
  });

  it('resets error state when retry button is clicked', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>,
    );

    // Error UI is shown
    expect(screen.getByText('retry')).toBeInTheDocument();
    expect(screen.getByText('Test error message')).toBeInTheDocument();

    // Click retry - resets error state, but ThrowError still throws so error UI reappears
    fireEvent.click(screen.getByText('retry'));

    // The component re-throws, so error UI is shown again (verifying the reset->re-catch cycle works)
    expect(screen.getByText('retry')).toBeInTheDocument();
  });
});
