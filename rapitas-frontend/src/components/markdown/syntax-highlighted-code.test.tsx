/**
 * Tests for syntax-highlighted-code
 *
 * Mocks the PrismAsync module (real highlighting async-loads refractor
 * grammars) and verifies the shared component maps theme keys to the correct
 * style objects and forwards every call-site prop 1:1.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vscDarkPlus, oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import SyntaxHighlightedCode from './syntax-highlighted-code';

const mocks = vi.hoisted(() => ({
  highlighter: vi.fn(),
}));

vi.mock('react-syntax-highlighter/dist/esm/prism-async-light', () => ({
  default: (props: { children?: ReactNode }) => {
    mocks.highlighter(props);
    return <pre data-testid="mock-highlighter">{props.children}</pre>;
  },
}));

describe('SyntaxHighlightedCode', () => {
  it('renders the code string through the PrismAsync highlighter', () => {
    const { getByTestId } = render(
      <SyntaxHighlightedCode code={'const a = 1;'} language="ts" theme="vscDarkPlus" />,
    );
    expect(getByTestId('mock-highlighter').textContent).toBe('const a = 1;');
    expect(mocks.highlighter).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'ts', PreTag: 'pre' }),
    );
  });

  it.each([
    ['vscDarkPlus', vscDarkPlus],
    ['oneDark', oneDark],
    ['oneLight', oneLight],
  ] as const)('maps theme key %s to its style object', (themeKey, styleObject) => {
    mocks.highlighter.mockClear();
    render(<SyntaxHighlightedCode code={'x'} language="js" theme={themeKey} />);
    expect(mocks.highlighter).toHaveBeenCalledWith(expect.objectContaining({ style: styleObject }));
  });

  it('forwards call-site props (preTag, showLineNumbers, customStyle, className, codeTagProps)', () => {
    mocks.highlighter.mockClear();
    const customStyle = { margin: 0, borderRadius: '0.5rem' };
    const codeTagProps = { style: { fontSize: 'inherit' } };
    render(
      <SyntaxHighlightedCode
        code={'y'}
        language="bash"
        theme="oneDark"
        preTag="div"
        showLineNumbers={true}
        customStyle={customStyle}
        className="mt-0!"
        codeTagProps={codeTagProps}
      />,
    );
    expect(mocks.highlighter).toHaveBeenCalledWith(
      expect.objectContaining({
        PreTag: 'div',
        showLineNumbers: true,
        customStyle,
        className: 'mt-0!',
        codeTagProps,
      }),
    );
  });
});
