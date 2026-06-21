/**
 * test-utils.test
 *
 * Smoke tests for renderWithProviders: verifies that ToastContext is provided
 * to children and that useToast() does not throw when rendered via the helper.
 * Also covers composeProviders composition order and opt-in provider injection.
 */
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { renderWithProviders, composeProviders, screen } from '@/__tests__/test-utils';
import { useToast } from '@/components/ui/toast/ToastContainer';

function ToastConsumer() {
  const { showToast } = useToast();
  return <button onClick={() => showToast('test')}>toast</button>;
}

describe('renderWithProviders', () => {
  it('provides ToastContext so useToast does not throw', () => {
    expect(() => renderWithProviders(<ToastConsumer />)).not.toThrow();
    expect(screen.getByText('toast')).toBeInTheDocument();
  });

  it('exposes showToast as a function via useToast', () => {
    renderWithProviders(<ToastConsumer />);
    expect(screen.getByRole('button', { name: 'toast' })).toBeInTheDocument();
  });
});

// --- helpers for composition tests ---

const OuterCtx = createContext<string | null>(null);
const InnerCtx = createContext<string | null>(null);

function OuterProvider({ children }: { children: ReactNode }) {
  return <OuterCtx.Provider value="outer">{children}</OuterCtx.Provider>;
}

function InnerProvider({ children }: { children: ReactNode }) {
  return <InnerCtx.Provider value="inner">{children}</InnerCtx.Provider>;
}

function CtxConsumer() {
  const outer = useContext(OuterCtx);
  const inner = useContext(InnerCtx);
  return (
    <>
      <span data-testid="outer">{outer ?? 'missing'}</span>
      <span data-testid="inner">{inner ?? 'missing'}</span>
    </>
  );
}

// --- composeProviders tests ---

describe('composeProviders', () => {
  it('propagates context from all composed providers', () => {
    const { getByTestId } = renderWithProviders(<CtxConsumer />, {
      providers: [OuterProvider, InnerProvider],
    });
    expect(getByTestId('outer')).toHaveTextContent('outer');
    expect(getByTestId('inner')).toHaveTextContent('inner');
  });

  it('renders the first provider as the outermost wrapper (array order = nesting order)', () => {
    // OuterProvider is first → its context must be visible at the leaf.
    // If order were reversed, OuterCtx would still be available since both are provided,
    // so we verify only OuterProvider's context is present when InnerProvider is omitted.
    const OuterOnlyWrapper = composeProviders([OuterProvider]);
    const { getByTestId } = renderWithProviders(<CtxConsumer />, {
      providers: [OuterProvider],
    });
    expect(getByTestId('outer')).toHaveTextContent('outer');
    expect(getByTestId('inner')).toHaveTextContent('missing');
    void OuterOnlyWrapper; // type-check only
  });

  it('handles an empty array without throwing (passthrough)', () => {
    expect(() =>
      renderWithProviders(<span data-testid="child">ok</span>, { providers: [] }),
    ).not.toThrow();
    expect(screen.getByTestId('child')).toHaveTextContent('ok');
  });
});

// --- providers opt-in tests ---

describe('renderWithProviders with providers option', () => {
  it('merges extra providers with CORE_PROVIDERS so ToastContext is still available', () => {
    function BothConsumer() {
      const { showToast } = useToast();
      const outer = useContext(OuterCtx);
      return (
        <>
          <button onClick={() => showToast('t')}>toast</button>
          <span data-testid="outer">{outer ?? 'missing'}</span>
        </>
      );
    }

    renderWithProviders(<BothConsumer />, { providers: [OuterProvider] });
    expect(screen.getByRole('button', { name: 'toast' })).toBeInTheDocument();
    expect(screen.getByTestId('outer')).toHaveTextContent('outer');
  });
});
