/**
 * Tests for lazy-syntax-highlighter
 *
 * Mocks the PrismAsync module (the underlying highlighter) and verifies the
 * next/dynamic wrapper shows the shared skeleton before resolution and renders
 * the highlighted code once the dynamic import resolves (awaited via findBy,
 * matching the mermaid-block async test convention).
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LazySyntaxHighlighter } from './lazy-syntax-highlighter';

vi.mock('react-syntax-highlighter/dist/esm/prism-async-light', () => ({
  default: ({ children }: { children?: ReactNode }) => (
    <pre data-testid="mock-highlighter">{children}</pre>
  ),
}));

describe('LazySyntaxHighlighter', () => {
  // NOTE: Single flow — next/dynamic caches the resolved module, so only the
  // very first render in this file can observe the pre-resolution skeleton.
  it('shows the shared SkeletonBlock first, then the highlighted code after resolution', async () => {
    const { container, queryByTestId, findByTestId } = render(
      <LazySyntaxHighlighter code={'const lazy = true;'} language="ts" theme="vscDarkPlus" />,
    );
    // Pre-resolution: no highlighter yet, the pulse skeleton holds the block.
    expect(queryByTestId('mock-highlighter')).toBeNull();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    // Post-resolution: highlighted code replaces the skeleton.
    const highlighted = await findByTestId('mock-highlighter');
    expect(highlighted.textContent).toBe('const lazy = true;');
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('renders subsequent instances with the resolved highlighter', async () => {
    const { findByTestId } = render(
      <LazySyntaxHighlighter code={'second'} language="js" theme="oneDark" />,
    );
    const highlighted = await findByTestId('mock-highlighter');
    expect(highlighted.textContent).toBe('second');
  });
});
