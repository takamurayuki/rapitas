/**
 * link-card.test
 *
 * Covers what a link card looks like after a save/load round trip, which is
 * where it was wrong. DOMPurify removes `target` on load, so a card restored
 * from a saved note had lost it, and the fallback that recognises older
 * cards tested for exactly that attribute — it could never match saved
 * content (#1067).
 */
import { describe, it, expect, vi } from 'vitest';
import DOMPurify from 'dompurify';
import { createLinkNode, normalizeLinkCards } from './link-card';

const labels = { copyDoneText: 'copied' };

/** Put HTML through the sanitizer the editor applies when loading a note. */
function loaded(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = DOMPurify.sanitize(html);
  document.body.appendChild(root);
  return root;
}

describe('normalizeLinkCards', () => {
  it('restores target, which the sanitizer removes', () => {
    const card = createLinkNode('https://x.example', 'X', '');
    const root = loaded(card.outerHTML);
    expect(root.querySelector('a')!.getAttribute('target')).toBeNull();

    normalizeLinkCards(root, vi.fn(), labels);
    expect(root.querySelector('a')!.getAttribute('target')).toBe('_blank');
  });

  // The fallback exists for cards written before the data attribute. It used
  // to require target === '_blank', which sanitization had already removed.
  it('recognises an older card that has no data attribute', () => {
    const root = loaded(
      '<a href="https://x.example" rel="noopener noreferrer"' +
        ' style="display: inline-flex; background: rgb(244, 244, 245);">X</a>',
    );
    normalizeLinkCards(root, vi.fn(), labels);
    const a = root.querySelector('a')!;
    expect(a.dataset.rapitasLinkCard).toBe('1');
    expect(a.getAttribute('target')).toBe('_blank');
  });

  it('leaves an ordinary link alone', () => {
    const root = loaded('<a href="https://x.example">plain</a>');
    normalizeLinkCards(root, vi.fn(), labels);
    const a = root.querySelector('a')!;
    expect(a.dataset.rapitasLinkCard).toBeUndefined();
    expect(a.getAttribute('target')).toBeNull();
  });

  it('survives a full round trip with its card markers intact', () => {
    const card = createLinkNode('https://x.example', 'X', '');
    const root = loaded(card.outerHTML);
    normalizeLinkCards(root, vi.fn(), labels);
    const a = root.querySelector('a')!;
    expect(a.dataset.rapitasLinkCard).toBe('1');
    expect(a.rel).toContain('noopener');
    expect(a.getAttribute('href')).toBe('https://x.example');
  });
});
