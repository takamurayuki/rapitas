/**
 * Tests for mermaid-block
 *
 * Mocks the mermaid module (real rendering is async browser DOM work) and
 * covers: mermaid fences routing to MermaidBlock through MarkdownView, other
 * fences staying code blocks, the raw-source error fallback, and the hast
 * fence-source extraction helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { MermaidBlock, extractMermaidSource } from './mermaid-block';
import { MarkdownView } from './MarkdownView';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({
  default: { initialize: mocks.initialize, render: mocks.render },
}));

const MESSAGES = {
  common: {
    mermaidRenderError: '図の描画に失敗したため、ソースを表示しています',
    mermaidRendering: '図を描画中...',
  },
};

const renderWithIntl = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="ja" messages={MESSAGES}>
      {ui}
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  mocks.initialize.mockClear();
  mocks.render.mockReset();
  mocks.render.mockResolvedValue({ svg: '<svg data-mermaid-mock="true"></svg>' });
});

describe('MermaidBlock via MarkdownView', () => {
  it('renders a ```mermaid fence as a diagram (no code block)', async () => {
    const { container } = renderWithIntl(
      <MarkdownView content={'```mermaid\nflowchart TD\n  A-->B\n```'} />,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-mermaid-mock]')).not.toBeNull();
    });
    expect(container.querySelector('pre')).toBeNull();
    expect(mocks.render).toHaveBeenCalledWith(expect.any(String), 'flowchart TD\n  A-->B');
    expect(mocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', startOnLoad: false }),
    );
  });

  it('leaves non-mermaid fences as normal code blocks', async () => {
    const { container } = renderWithIntl(<MarkdownView content={'```js\nconst a = 1;\n```'} />);
    expect(container.querySelector('pre')).not.toBeNull();
    expect(container.querySelector('[data-mermaid-mock]')).toBeNull();
    expect(mocks.render).not.toHaveBeenCalled();
  });
});

describe('MermaidBlock error fallback', () => {
  it('shows the raw source with a subdued error line when rendering fails', async () => {
    mocks.render.mockRejectedValue(new Error('parse error'));
    const { container, getByText } = renderWithIntl(<MermaidBlock source={'broken -->'} />);
    await waitFor(() => {
      expect(getByText(MESSAGES.common.mermaidRenderError)).toBeInTheDocument();
    });
    // The raw source stays readable in the familiar code-block styling.
    expect(container.querySelector('pre code')?.textContent).toBe('broken -->');
    expect(container.querySelector('[data-mermaid-mock]')).toBeNull();
  });

  it('uses a unique render id per diagram', async () => {
    renderWithIntl(
      <>
        <MermaidBlock source={'flowchart TD\n  A'} />
        <MermaidBlock source={'flowchart TD\n  B'} />
      </>,
    );
    await waitFor(() => {
      expect(mocks.render).toHaveBeenCalledTimes(2);
    });
    const [idA] = mocks.render.mock.calls[0] as [string, string];
    const [idB] = mocks.render.mock.calls[1] as [string, string];
    expect(idA).not.toBe(idB);
  });
});

describe('extractMermaidSource', () => {
  const preNode = (className: string[], value: string) => ({
    type: 'element',
    tagName: 'pre',
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: { className },
        children: [{ type: 'text', value }],
      },
    ],
  });

  it('extracts the fence body for language-mermaid', () => {
    expect(extractMermaidSource(preNode(['language-mermaid'], 'graph TD\n  A-->B\n'))).toBe(
      'graph TD\n  A-->B',
    );
  });

  it('returns null for other languages and malformed nodes', () => {
    expect(extractMermaidSource(preNode(['language-ts'], 'const a = 1;\n'))).toBeNull();
    expect(extractMermaidSource({ type: 'element', tagName: 'pre', children: [] })).toBeNull();
    expect(extractMermaidSource(undefined)).toBeNull();
    expect(extractMermaidSource(null)).toBeNull();
  });
});

// NOTE: 2026-08-25. mermaid's default (useMaxWidth: true) emits width:100% plus
// a max-width, so a diagram was scaled down to whatever the container was —
// inside the workflow panel that shrank the labels until they were unreadable.
// The diagram must keep its intrinsic size and the CONTAINER must scroll.
describe('MermaidBlock sizing', () => {
  it('renders diagrams at intrinsic size rather than scaling them to the container', async () => {
    renderWithIntl(<MermaidBlock source="graph TD; A-->B;" />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());

    const config = mocks.initialize.mock.calls[0][0] as Record<string, unknown>;
    for (const diagramType of ['flowchart', 'sequence', 'class', 'state', 'er']) {
      expect(config[diagramType], `useMaxWidth for ${diagramType}`).toEqual({
        useMaxWidth: false,
      });
    }
  });

  it('lets the container scroll instead of clipping a wide diagram', async () => {
    const { container } = renderWithIntl(<MermaidBlock source="graph TD; A-->B;" />);
    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull());

    const box = container.firstElementChild as HTMLElement;
    expect(box.className).toContain('overflow-x-auto');
    // `flex justify-center` would put the overflowing left edge out of reach.
    expect(box.className).not.toContain('justify-center');
    expect(box.className).not.toContain('overflow-hidden');
  });
});
