/**
 * Create a styled link-card anchor element.
 */
export function createLinkNode(
  url: string,
  title: string,
  favicon: string,
): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.dataset.rapitasLinkCard = '1';
  Object.assign(a.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '0 2px',
    background: '#f4f4f5',
    borderRadius: '3px',
    textDecoration: 'none',
    color: '#3b82f6',
    fontSize: '13px',
    lineHeight: '1',
    height: '1.5em',
    cursor: 'pointer',
    verticalAlign: 'text-bottom',
  });

  if (favicon) {
    const img = document.createElement('img');
    img.src = favicon;
    img.alt = '';
    Object.assign(img.style, {
      display: 'block',
      width: '13px',
      height: '13px',
      borderRadius: '2px',
      flexShrink: '0',
      objectFit: 'cover',
      alignSelf: 'center',
    });
    a.appendChild(img);
  }

  const span = document.createElement('span');
  span.textContent = title;
  Object.assign(span.style, {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  });
  a.appendChild(span);

  return a;
}

/**
 * Walk existing link-card anchors in a root element and normalise their
 * inline styles so they render consistently (e.g. after loading saved HTML).
 *
 * @param root          The container element (contentEditable div)
 * @param onContentChange  Callback for dirty-flag (used to wire code-block event handlers)
 */
export function normalizeLinkCards(
  root: HTMLElement,
  onContentChange: () => void,
): void {
  const anchors = Array.from(root.querySelectorAll('a'));

  for (const a of anchors) {
    const anchor = a as HTMLAnchorElement;

    const isKnownCard = anchor.dataset.rapitasLinkCard === '1';
    const looksLikeCard =
      anchor.target === '_blank' &&
      anchor.rel.includes('noopener') &&
      anchor.style.display === 'inline-flex' &&
      !!anchor.style.background;

    if (!isKnownCard && !looksLikeCard) continue;

    anchor.dataset.rapitasLinkCard = '1';

    anchor.style.lineHeight = '1';
    anchor.style.height = '1.5em';
    anchor.style.verticalAlign = 'text-bottom';

    if (!anchor.style.padding) {
      anchor.style.padding = '0 2px';
    }

    const img = anchor.querySelector('img');
    if (img instanceof HTMLImageElement) {
      img.style.display = 'block';
      img.style.width = '13px';
      img.style.height = '13px';
      img.style.objectFit = 'cover';
      img.style.alignSelf = 'center';
      if (!img.style.borderRadius) img.style.borderRadius = '2px';
      if (!img.style.flexShrink) img.style.flexShrink = '0';
    }
  }

  // Re-attach event handlers for code blocks
  const codeBlocks = Array.from(
    root.querySelectorAll("[data-rapitas-code-block='1']"),
  );
  for (const block of codeBlocks) {
    const codeElement = block.querySelector('code[contenteditable]');
    const buttons = block.querySelectorAll('button');
    const copyButton = buttons[0];
    const deleteButton = buttons[1];

    if (codeElement) {
      codeElement.addEventListener('input', onContentChange);

      codeElement.addEventListener('keydown', (e) => {
        const keyboardEvent = e as KeyboardEvent;
        if (
          keyboardEvent.key === 'Backspace' ||
          keyboardEvent.key === 'Delete'
        ) {
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (range.startOffset === 0 && range.collapsed) {
              const container = range.startContainer;
              if (
                container === codeElement ||
                (container.parentNode === codeElement &&
                  container.previousSibling === null)
              ) {
                e.preventDefault();
                return;
              }
            }
          }
        }
      });
    }

    if (copyButton && codeElement) {
      copyButton.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const codeText = codeElement.textContent || '';
        navigator.clipboard.writeText(codeText).then(() => {
          const originalText = copyButton.textContent;
          copyButton.textContent = 'コピーしました！';
          (copyButton as HTMLElement).style.backgroundColor = '#22c55e';
          setTimeout(() => {
            copyButton.textContent = originalText;
            (copyButton as HTMLElement).style.backgroundColor = '#334155';
          }, 2000);
        });
      };
    }

    if (deleteButton) {
      deleteButton.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        (block as HTMLElement).remove();
        onContentChange();
      };
    }
  }
}
