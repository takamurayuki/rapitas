/**
 * AppIcon.test
 *
 * Checks that the header logo is the current task-dash app icon (brand gradient
 * tile + three task rows), not the old clipboard glyph.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('matches the desktop app-icon.svg geometry exactly', () => {
    // vitest runs from rapitas-frontend/; the desktop icon is the source of truth.
    const source = readFileSync(
      resolve(process.cwd(), '../rapitas-desktop/src-tauri/icons/app-icon.svg'),
      'utf8',
    );
    const desktop = new DOMParser().parseFromString(source, 'image/svg+xml');
    const { container } = render(<AppIcon />);

    const attrs = (root: ParentNode, selector: string, name: string) =>
      Array.from(root.querySelectorAll(selector)).map((el) => el.getAttribute(name));

    expect(attrs(container, 'g path', 'd')).toEqual(attrs(desktop, 'g path', 'd'));
    expect(attrs(container, 'g', 'transform')).toEqual(attrs(desktop, 'g', 'transform'));
    expect(attrs(container, 'rect', 'rx')).toEqual(attrs(desktop, 'rect', 'rx'));
    expect(attrs(container, 'stop', 'stop-color')).toEqual(attrs(desktop, 'stop', 'stop-color'));
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
