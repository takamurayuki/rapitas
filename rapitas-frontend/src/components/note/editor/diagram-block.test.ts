/**
 * diagram-block.test
 *
 * The failure path is the one that matters here. Mermaid builds its diagram in
 * a working element it appends to `document.body`, and on a parse error it
 * draws "Syntax error in text" into that element and throws without removing
 * it — `suppressErrorRendering` defaults to false. Anything left behind is
 * outside the note entirely, at the bottom of whatever page is open.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  renderMermaidBlock,
  renderAllDiagrams,
  getContentWithoutDiagramSvg,
  type DiagramBlockLabels,
} from './diagram-block';

const labels: DiagramBlockLabels = {
  deleteTitle: 'delete',
  loadingText: 'loading',
  syntaxErrorText: 'syntax error',
};

/** Mermaid's own behaviour on a parse failure, reduced to what it leaves behind. */
const renderMock = vi.fn();

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: (id: string, source: string) => renderMock(id, source),
  },
}));

/**
 * Appends the working element mermaid would, paints the error SVG into it, and
 * throws — matching mermaid.core.mjs's `appendDivSvgG(select("body"), …)` plus
 * `errorRenderer_default.draw(…); throw e`.
 */
function leakThenThrow(id: string): never {
  const div = document.createElement('div');
  div.id = `d${id}`;
  div.innerHTML = '<svg><text>Syntax error in text</text></svg>';
  document.body.appendChild(div);
  throw new Error('Parse error');
}

/** A diagram block as createDiagramBlockNode builds it. */
function makeBlock(source: string): HTMLElement {
  const block = document.createElement('div');
  block.className = 'diagram-block';
  const pre = document.createElement('pre');
  pre.className = 'diagram-source';
  pre.textContent = source;
  const render = document.createElement('div');
  render.className = 'diagram-render';
  block.append(pre, render);
  return block;
}

/** Anything mermaid left on the body, by the id shape it uses. */
const strayElements = () => document.body.querySelectorAll('[id^="dmermaid-"]');

describe('renderMermaidBlock', () => {
  beforeEach(() => {
    renderMock.mockReset();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('leaves nothing on the body when the source fails to parse', async () => {
    renderMock.mockImplementation((id: string) => leakThenThrow(id));
    const block = makeBlock('not a diagram');
    document.body.appendChild(block);

    await renderMermaidBlock(block, labels);

    expect(strayElements()).toHaveLength(0);
    expect(document.body.textContent).not.toContain('Syntax error in text');
  });

  it('still shows its own message inside the block on failure', async () => {
    renderMock.mockImplementation((id: string) => leakThenThrow(id));
    const block = makeBlock('not a diagram');

    await renderMermaidBlock(block, labels);

    expect(block.querySelector('.diagram-error')?.textContent).toContain('syntax error');
  });

  it('renders the SVG into the block on success', async () => {
    renderMock.mockResolvedValue({ svg: '<svg id="ok"></svg>' });
    const block = makeBlock('graph TD\n A --> B');

    await renderMermaidBlock(block, labels);

    expect(block.querySelector('.diagram-render svg')).not.toBeNull();
    expect(strayElements()).toHaveLength(0);
  });

  it('does nothing when the block has no source', async () => {
    const block = makeBlock('   ');

    await renderMermaidBlock(block, labels);

    expect(renderMock).not.toHaveBeenCalled();
  });

  // renderAllDiagrams walks every block in a note, so one note with several
  // broken diagrams leaked several elements at once.
  it('leaves nothing on the body when several blocks in one note fail', async () => {
    renderMock.mockImplementation((id: string) => leakThenThrow(id));
    const container = document.createElement('div');
    container.append(makeBlock('bad one'), makeBlock('bad two'), makeBlock('bad three'));
    document.body.appendChild(container);

    await renderAllDiagrams(container, labels);

    expect(strayElements()).toHaveLength(0);
    expect(container.querySelectorAll('.diagram-error')).toHaveLength(3);
  });
});

/**
 * The save path strips caret anchors — editing aids that must not reach
 * storage. Reported 2026-10-18 (#1067): it was also deleting the border
 * line, because pressing that button with nothing selected produces an
 * empty styled span on purpose. The line showed in the editor and was gone
 * on reopening.
 */
describe('getContentWithoutDiagramSvg', () => {
  const editorWith = (html: string): HTMLElement => {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  };

  it('keeps a border line inserted with nothing selected', () => {
    const line =
      '<span style="border-left: 3px solid rgb(239, 68, 68); padding-left: 8px;"></span>';
    const out = getContentWithoutDiagramSvg(editorWith(`<p>a</p>${line}<p>b</p>`));
    expect(out).toContain('border-left');
  });

  it('keeps a border line wrapping selected text', () => {
    const out = getContentWithoutDiagramSvg(
      editorWith('<span style="border-left: 3px solid rgb(1, 2, 3);">quoted</span>'),
    );
    expect(out).toContain('quoted');
    expect(out).toContain('border-left');
  });

  // Anything that paints without text is a mark the user made, not an aid.
  it('keeps an empty highlight span', () => {
    const out = getContentWithoutDiagramSvg(
      editorWith('<span style="background-color: rgb(254, 240, 138);"></span>'),
    );
    expect(out).toContain('background-color');
  });

  it('still strips the zero-width caret anchors it exists for', () => {
    const out = getContentWithoutDiagramSvg(
      editorWith('<span style="color: rgb(1, 2, 3);">​</span>'),
    );
    expect(out).toBe('');
  });

  it('still strips an empty colour span, which shows nothing either way', () => {
    const out = getContentWithoutDiagramSvg(editorWith('<span style="font-size: 24px;"></span>'));
    expect(out).toBe('');
  });

  it('leaves the diagram source but clears its rendered SVG', () => {
    const out = getContentWithoutDiagramSvg(
      editorWith(
        '<div class="diagram-block"><pre class="diagram-source">graph TD</pre><div class="diagram-render"><svg></svg></div></div>',
      ),
    );
    expect(out).toContain('graph TD');
    expect(out).not.toContain('<svg>');
  });
});
