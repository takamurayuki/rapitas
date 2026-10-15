import { render, screen } from '@testing-library/react';
import { Spinner } from '../Spinner';

describe('Spinner', () => {
  it('renders with role=status', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the default screen-reader label', () => {
    render(<Spinner />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders a custom screen-reader label', () => {
    render(<Spinner label="読み込み中" />);
    expect(screen.getByText('読み込み中')).toBeInTheDocument();
  });

  it('applies the size class for each size variant', () => {
    const { container, rerender } = render(<Spinner size="sm" />);
    expect(container.querySelector('svg')).toHaveClass('w-3.5', 'h-3.5');

    rerender(<Spinner size="md" />);
    expect(container.querySelector('svg')).toHaveClass('w-5', 'h-5');

    rerender(<Spinner size="lg" />);
    expect(container.querySelector('svg')).toHaveClass('w-8', 'h-8');

    rerender(<Spinner size="xl" />);
    expect(container.querySelector('svg')).toHaveClass('w-12', 'h-12');
  });

  it('always includes animate-spin', () => {
    const { container } = render(<Spinner />);
    expect(container.querySelector('svg')).toHaveClass('animate-spin');
  });

  it('applies additional classes', () => {
    const { container } = render(<Spinner className="text-red-500" />);
    expect(container.querySelector('svg')).toHaveClass('text-red-500');
  });
});
