import { render } from '@testing-library/react';
import AppIcon from '../app-icon';

describe('AppIcon', () => {
  it('renders an SVG element', () => {
    const { container } = render(<AppIcon />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('uses default size of 20', () => {
    const { container } = render(<AppIcon />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
  });

  it('uses custom size', () => {
    const { container } = render(<AppIcon size={32} />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
  });

  it('applies custom className', () => {
    const { container } = render(<AppIcon className="text-blue-500" />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('text-blue-500');
  });

  it('has correct viewBox', () => {
    const { container } = render(<AppIcon />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
  });

  it('renders path elements for the icon', () => {
    const { container } = render(<AppIcon />);

    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2);
  });

  it('uses currentColor for stroke', () => {
    const { container } = render(<AppIcon />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('fill', 'none');
  });
});
