/**
 * markdown-density.test
 *
 * `MarkdownView` keeps the document rhythm by default (the workflow file
 * viewer and other existing callers must not change) and only tightens for
 * a chat bubble when asked.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownView } from './MarkdownView';
import { densityClass } from './markdown-density';

const wrapper = (container: HTMLElement) => container.firstElementChild as HTMLElement;

describe('MarkdownView density', () => {
  it('is the document rhythm when no density is given', () => {
    const { container } = render(<MarkdownView content={'# 見出し\n\n本文'} />);
    expect(wrapper(container).dataset.density).toBe('document');
    expect(wrapper(container).className).not.toContain('[&_h1]:');
    expect(densityClass('document')).toBe('');
  });

  it('tightens headings and margins for a chat bubble', () => {
    const { container } = render(<MarkdownView content={'# 見出し\n\n本文'} density="chat" />);
    const cls = wrapper(container).className;
    expect(wrapper(container).dataset.density).toBe('chat');
    expect(cls).toContain('[&_h1]:!text-[15px]');
    expect(cls).toContain('[&_h2]:!mt-3');
    expect(cls).toContain('[&_p]:!my-1.5');
  });

  it('keeps a caller className alongside the density', () => {
    const { container } = render(<MarkdownView content="本文" density="chat" className="extra" />);
    expect(wrapper(container).className).toContain('extra');
  });
});
