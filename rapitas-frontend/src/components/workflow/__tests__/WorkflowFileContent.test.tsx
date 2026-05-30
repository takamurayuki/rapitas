import { render, fireEvent } from '@testing-library/react';
import { WorkflowFileContent } from '../WorkflowFileContent';
import type { WorkflowTab } from '../workflow-viewer-utils';

/**
 * Regression coverage for the in-file table of contents: every TOC link must
 * resolve to a rendered <h2> with the matching id. The earlier counter-based id
 * scheme desynced under StrictMode's double render; these tests pin the slug
 * scheme so links keep landing on their section.
 */

const TAB: WorkflowTab = {
  id: 'plan',
  label: 'Plan',
  // Minimal stand-in for the lucide icon used only in the empty state.
  icon: () => null,
  emptyText: 'empty',
} as unknown as WorkflowTab;

function renderContent(content: string) {
  return render(
    <WorkflowFileContent
      isLoading={false}
      activeFile={{ exists: true, content }}
      activeTabConfig={TAB}
      showApprovalButton={false}
      showCompleteButton={false}
    />,
  );
}

/** The TOC is collapsed by default; click its label to reveal the link list. */
function openToc(container: HTMLElement) {
  fireEvent.click(container.querySelector('nav > button')!);
}

describe('WorkflowFileContent TOC', () => {
  it('gives each rendered <h2> the same id the TOC link targets', () => {
    const md = ['# Title', '', '## 概要', 'body', '', '## 詳細設計', 'body'].join('\n');
    const { container } = renderContent(md);
    openToc(container);

    const navButtons = Array.from(container.querySelectorAll('nav div button'));
    expect(navButtons.map((b) => b.textContent)).toEqual(['概要', '詳細設計']);

    // Each H2 id must exist so getElementById in the click handler resolves.
    const overview = container.querySelector('[id="wf-h-概要"]');
    const design = container.querySelector('[id="wf-h-詳細設計"]');
    expect(overview?.tagName).toBe('H2');
    expect(design?.tagName).toBe('H2');
    expect(overview?.textContent).toBe('概要');
  });

  it('matches ids for headings with inline markdown (code/bold)', () => {
    const md = ['## `code` セクション', 'x', '', '## **太字** 見出し', 'y'].join('\n');
    const { container } = renderContent(md);

    expect(container.querySelector('[id="wf-h-code-セクション"]')?.tagName).toBe('H2');
    expect(container.querySelector('[id="wf-h-太字-見出し"]')?.tagName).toBe('H2');
  });

  it('ignores ## inside fenced code blocks', () => {
    const md = ['## Real', '', '```', '## Fake', '```'].join('\n');
    const { container } = renderContent(md);
    openToc(container);

    const navButtons = Array.from(container.querySelectorAll('nav div button'));
    expect(navButtons.map((b) => b.textContent)).toEqual(['Real']);
  });

  it('starts collapsed and toggles the TOC list open/closed', () => {
    const md = ['## 概要', 'a', '', '## 詳細', 'b'].join('\n');
    const { container } = renderContent(md);

    // Collapsed by default — only the label button, no link list.
    expect(container.querySelectorAll('nav div button')).toHaveLength(0);
    openToc(container);
    expect(container.querySelectorAll('nav div button')).toHaveLength(2);
    fireEvent.click(container.querySelector('nav > button')!);
    expect(container.querySelectorAll('nav div button')).toHaveLength(0);
  });

  it('lists one TOC entry for duplicate-named headings', () => {
    const md = ['## 受け入れ基準', 'a', '', '## 受け入れ基準', 'b'].join('\n');
    const { container } = renderContent(md);
    openToc(container);

    const navButtons = Array.from(container.querySelectorAll('nav div button'));
    expect(navButtons).toHaveLength(1);
    expect(container.querySelector('[id="wf-h-受け入れ基準"]')?.tagName).toBe('H2');
  });
});
