/**
 * ThemePicker.test
 *
 * The picker replaces a flat wall of ~40 theme chips with one button that
 * opens a category → theme tree. These pin the behaviour that makes it
 * usable: the closed state names the choice, the selected theme's category
 * starts open, and picking closes the panel.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Category, Theme } from '@/types';
import { ThemePicker } from '../ThemePicker';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const categories = [
  { id: 1, name: '開発', color: '#000', mode: 'both', sortOrder: 0 },
  { id: 2, name: '読書', color: '#000', mode: 'both', sortOrder: 1 },
] as Category[];
const themes = [
  { id: 10, name: 'rapitas', color: '#f7a85f', sortOrder: 0, categoryId: 1 },
  { id: 11, name: 'fusen', color: '#8b5cf6', sortOrder: 1, categoryId: 1 },
  { id: 20, name: '小説', color: '#e0457b', sortOrder: 0, categoryId: 2 },
] as Theme[];

describe('ThemePicker', () => {
  it('names the selected category and theme on the closed button', () => {
    render(<ThemePicker themes={themes} categories={categories} value={20} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { expanded: false })).toHaveTextContent('読書›小説');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it("opens with the selected theme's category expanded and the others closed", () => {
    render(<ThemePicker themes={themes} categories={categories} value={20} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('option', { name: '小説' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('option', { name: 'rapitas' })).not.toBeInTheDocument();
  });

  it('reveals a category on click and closes after a theme is picked', () => {
    const onChange = vi.fn();
    render(<ThemePicker themes={themes} categories={categories} value={20} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: /開発/ }));
    fireEvent.click(screen.getByRole('option', { name: 'fusen' }));
    expect(onChange).toHaveBeenCalledWith(themes[1]);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes on Escape without changing the value', () => {
    const onChange = vi.fn();
    render(<ThemePicker themes={themes} categories={categories} value={20} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers an "all" choice that reports null when the caller allows it', () => {
    const onChange = vi.fn();
    render(
      <ThemePicker
        themes={themes}
        categories={categories}
        value={null}
        onChange={onChange}
        allLabel="すべて"
      />,
    );
    const trigger = screen.getByRole('button', { expanded: false });
    expect(trigger).toHaveTextContent('すべて');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: 'すべて' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
