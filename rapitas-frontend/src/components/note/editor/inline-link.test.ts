/**
 * inline-link.test
 *
 * Turning selected text into a link, and taking the link back off again.
 * The cases that matter are the ones that decide whether a paste becomes a
 * link at all, and whether removing one keeps the words.
 */
import { describe, it, expect } from 'vitest';
import {
  createInlineLink,
  isInlineLink,
  isLinkCard,
  linkRange,
  styleInlineLink,
  unwrapInlineLink,
  urlFromPastedText,
} from './inline-link';

describe('urlFromPastedText', () => {
  it('takes a plain web URL', () => {
    expect(urlFromPastedText('https://example.com/docs')).toBe('https://example.com/docs');
    expect(urlFromPastedText('http://example.com')).toBe('http://example.com');
  });

  it('ignores the whitespace around a copied URL', () => {
    expect(urlFromPastedText('  https://example.com\n')).toBe('https://example.com');
  });

  // Pasting a sentence that happens to mention a link is still pasting a
  // sentence; only a URL on its own becomes one.
  it('refuses text that is not just a URL', () => {
    expect(urlFromPastedText('see https://example.com for details')).toBeNull();
    expect(urlFromPastedText('https://example.com https://other.example')).toBeNull();
  });

  it('refuses anything that is not http(s)', () => {
    for (const text of [
      'javascript:alert(1)',
      'file:///C:/Windows/System32/drivers/etc/hosts',
      'data:text/html,<script>alert(1)</script>',
      'mailto:a@b.c',
      'example.com',
      '',
      '   ',
    ]) {
      expect(urlFromPastedText(text)).toBeNull();
    }
  });

  it('refuses a URL longer than a browser would accept', () => {
    expect(urlFromPastedText(`https://example.com/${'x'.repeat(2048)}`)).toBeNull();
  });
});

describe('createInlineLink', () => {
  it('points at the URL and shows the text it was given', () => {
    const a = createInlineLink('https://example.com', 'the docs');
    expect(a.getAttribute('href')).toBe('https://example.com');
    expect(a.textContent).toBe('the docs');
  });

  it('is blue and underlined', () => {
    const a = createInlineLink('https://example.com', 'x');
    expect(a.style.textDecoration).toContain('underline');
    expect(a.style.color).toBeTruthy();
  });

  it('carries rel, so an opener is never handed out', () => {
    expect(createInlineLink('https://example.com', 'x').rel).toContain('noopener');
  });
});

describe('telling an inline link from a link card', () => {
  /** A card as `createLinkNode` builds one: inline-flex with a background. */
  function card(): HTMLAnchorElement {
    const a = document.createElement('a');
    a.href = 'https://example.com';
    a.rel = 'noopener noreferrer';
    a.style.display = 'inline-flex';
    a.style.background = '#f4f4f5';
    return a;
  }

  it('knows a card', () => {
    expect(isLinkCard(card())).toBe(true);
    expect(isInlineLink(card())).toBe(false);
  });

  // DOMPurify strips data-* on load, so a saved card is recognised by its
  // shape — and an inline link must not be mistaken for one.
  it('knows an inline link', () => {
    const a = createInlineLink('https://example.com', 'x');
    expect(isInlineLink(a)).toBe(true);
    expect(isLinkCard(a)).toBe(false);
  });

  it('knows a card by its data attribute even without the styles', () => {
    const a = document.createElement('a');
    a.dataset.rapitasLinkCard = '1';
    expect(isLinkCard(a)).toBe(true);
  });

  it('treats an anchor with no href as neither', () => {
    expect(isInlineLink(document.createElement('a'))).toBe(false);
  });
});

describe('styleInlineLink', () => {
  // A link saved and loaded again comes back without its inline styles in
  // some paths; it has to look like a link either way.
  it('restores the look of a bare anchor', () => {
    const a = document.createElement('a');
    a.href = 'https://example.com';
    a.textContent = 'x';
    styleInlineLink(a);
    expect(a.style.textDecoration).toContain('underline');
    expect(isInlineLink(a)).toBe(true);
  });
});

describe('unwrapInlineLink', () => {
  /** A paragraph holding `before [link] after`. */
  function paragraph(): { p: HTMLElement; a: HTMLAnchorElement } {
    const p = document.createElement('p');
    p.append('before ');
    const a = createInlineLink('https://example.com', 'the docs');
    p.append(a, ' after');
    return { p, a };
  }

  // The whole point: the words stay, only the link goes.
  it('keeps the text where it was', () => {
    const { p, a } = paragraph();
    unwrapInlineLink(a);
    expect(p.textContent).toBe('before the docs after');
    expect(p.querySelector('a')).toBeNull();
  });

  it('keeps rich content inside the link', () => {
    const a = createInlineLink('https://example.com', '');
    const strong = document.createElement('strong');
    strong.textContent = 'bold';
    a.append(strong);
    const p = document.createElement('p');
    p.append(a);

    unwrapInlineLink(a);
    expect(p.querySelector('strong')?.textContent).toBe('bold');
    expect(p.querySelector('a')).toBeNull();
  });

  it('does nothing to an anchor that is not in the document', () => {
    const a = createInlineLink('https://example.com', 'x');
    expect(() => unwrapInlineLink(a)).not.toThrow();
  });
});

describe('linkRange', () => {
  /** A paragraph in the document, with `from` selected inside it. */
  function selected(html: string, start: number, end: number) {
    const p = document.createElement('p');
    p.innerHTML = html;
    document.body.append(p);
    const range = document.createRange();
    const text = p.firstChild as Text;
    range.setStart(text, start);
    range.setEnd(text, end);
    return { p, range };
  }

  // The reported want: select some words, paste a URL, get a link.
  it('wraps the selected words in a link', () => {
    const { p, range } = selected('read the docs now', 5, 13);
    const a = linkRange(range, 'https://example.com');
    expect(a?.getAttribute('href')).toBe('https://example.com');
    expect(a?.textContent).toBe('the docs');
    expect(p.textContent).toBe('read the docs now');
  });

  it('gives the link the inline look', () => {
    const { range } = selected('read the docs now', 5, 13);
    const a = linkRange(range, 'https://example.com');
    expect(a && isInlineLink(a)).toBe(true);
  });

  it('refuses a collapsed selection — there is nothing to link', () => {
    const { range } = selected('read the docs', 4, 4);
    expect(linkRange(range, 'https://example.com')).toBeNull();
  });

  it('refuses a selection of nothing but spaces', () => {
    const { range } = selected('a    b', 1, 5);
    expect(linkRange(range, 'https://example.com')).toBeNull();
  });

  // Pasting a second URL over an existing link should move the link, not
  // nest one inside the other.
  it('re-points an existing link instead of nesting', () => {
    const p = document.createElement('p');
    const existing = createInlineLink('https://old.example', 'the docs');
    p.append(existing);
    document.body.append(p);

    const range = document.createRange();
    range.selectNodeContents(existing);
    const a = linkRange(range, 'https://new.example');

    expect(p.querySelectorAll('a')).toHaveLength(1);
    expect(a?.getAttribute('href')).toBe('https://new.example');
    expect(a?.textContent).toBe('the docs');
  });
});
