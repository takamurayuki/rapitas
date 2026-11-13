/**
 * AppIcon.test
 *
 * Checks that the header logo is the current task-dash app icon (brand gradient
 * tile + three task rows), not the old clipboard glyph.
 */
import { render } from '@testing-library/react';
import AppIcon from '../common/app-icon';

describe('AppIcon', () => {
  it('renders an SVG element', () => {
    const { container } = render(<AppIcon />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('uses default size of 32 (it draws its own tile)', () => {
    const { container } = render(<AppIcon />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
  });

  it('uses custom size', () => {
    const { container } = render(<AppIcon size={48} />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '48');
    expect(svg).toHaveAttribute('height', '48');
  });

  it('applies custom className', () => {
    const { container } = render(<AppIcon className="shrink-0" />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('shrink-0');
  });

  it('shares the 1024 artboard of the desktop app-icon.svg', () => {
    const { container } = render(<AppIcon />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 1024 1024');
  });

  it('draws the brand gradient tile', () => {
    const { container } = render(<AppIcon />);

    const stops = Array.from(container.querySelectorAll('stop'));
    expect(stops.map((s) => s.getAttribute('stop-color'))).toEqual(['#8B5CF6', '#6366F1']);
    const tile = container.querySelector('rect');
    const gradientId = container.querySelector('linearGradient')?.getAttribute('id');
    expect(tile).toHaveAttribute('fill', `url(#${gradientId})`);
  });

  it('draws three task rows (box + dash each) in white, not the clipboard', () => {
    const { container } = render(<AppIcon />);

    const mark = container.querySelector('g');
    expect(mark).toHaveAttribute('fill', '#FFFFFF');
    expect(container.querySelectorAll('g path').length).toBe(6);
    expect(container.querySelector('svg')).not.toHaveAttribute('stroke');
  });

  it('gives each instance its own gradient id', () => {
    const { container } = render(
      <>
        <AppIcon />
        <AppIcon />
      </>,
    );

    const ids = Array.from(container.querySelectorAll('linearGradient')).map((g) => g.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
