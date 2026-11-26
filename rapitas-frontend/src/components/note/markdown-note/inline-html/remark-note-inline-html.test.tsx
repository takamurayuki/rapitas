/**
 * remark-note-inline-html.test
 *
 * A note rendered by `MarkdownView` at note density draws the allowed inline
 * forms (text colour, highlight, font size, underline) and nothing else of
 * the raw HTML; other densities keep ignoring HTML as before.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownView } from '@/components/markdown/MarkdownView';

const note = (content: string) =>
  render(<MarkdownView content={content} density="note" />).container;

describe('allowed inline forms in a note', () => {
  it('draws a text colour', () => {
    const span = note('<span style="color:#E53935">赤字</span>').querySelector('span[style]');
    expect(span?.textContent).toBe('赤字');
    expect((span as HTMLElement).style.color).toBe('rgb(229, 57, 53)');
  });

  it('draws a highlight', () => {
    const mark = note('<mark style="background-color:#FFF59D">重要</mark>').querySelector('mark');
    expect(mark?.textContent).toBe('重要');
    expect((mark as HTMLElement).style.backgroundColor).toBe('rgb(255, 245, 157)');
  });

  it('draws a font size', () => {
    const span = note('<span style="font-size:24px">大</span>').querySelector('span[style]');
    expect(span?.textContent).toBe('大');
    expect((span as HTMLElement).style.fontSize).toBe('24px');
  });

  it('draws an underline', () => {
    expect(note('<u>下線</u>').querySelector('u')?.textContent).toBe('下線');
  });

  it('keeps bold inside a colour', () => {
    const span = note('前<span style="color:#E53935">**太**</span>後').querySelector('span[style]');
    expect(span?.querySelector('strong')?.textContent).toBe('太');
  });

  it('draws a colour inside a table cell', () => {
    const container = note(
      '| a | b |\n| --- | --- |\n| <span style="color:#E53935">赤</span> | x |',
    );
    const span = container.querySelector('td span[style]');
    expect(span?.textContent).toBe('赤');
  });

  it('nests the allowed forms', () => {
    const container = note(
      '<span style="font-size:24px"><span style="color:#E53935">大赤</span></span>',
    );
    const outer = container.querySelector('span[style*="font-size"]') as HTMLElement;
    expect(outer.style.fontSize).toBe('24px');
    expect((outer.querySelector('span[style]') as HTMLElement).style.color).toBe(
      'rgb(229, 57, 53)',
    );
  });
});

describe('disallowed HTML in a note', () => {
  it('is not drawn as an element', () => {
    const container = note(
      '<span onclick="alert(1)">a</span> <span style="font-family:x">b</span>',
    );
    expect(container.querySelector('span[onclick]')).toBeNull();
    expect(container.querySelector('span[style]')).toBeNull();
    expect(container.textContent).toContain('a');
    expect(container.textContent).toContain('b');
  });

  it('draws no script', () => {
    const container = note('前<script>alert(1)</script>後');
    expect(container.querySelector('script')).toBeNull();
  });

  it('leaves an unpaired allowed tag undrawn', () => {
    const container = note('<span style="color:#E53935">赤');
    expect(container.querySelector('span[style]')).toBeNull();
    expect(container.textContent).toContain('赤');
  });
});

describe('other densities', () => {
  it('still ignore the HTML', () => {
    const { container } = render(
      <MarkdownView content={'<span style="color:#E53935">赤</span>'} />,
    );
    expect(container.querySelector('span[style]')).toBeNull();
  });
});
