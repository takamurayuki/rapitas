/**
 * test-utils
 *
 * Shared render utilities for tests. Wraps components in all required providers
 * so individual test files do not need to import or manage providers directly.
 * Not responsible for mocking APIs or stores — do that in each test file.
 */
import type { ReactNode } from 'react';
import type { RenderOptions } from '@testing-library/react';
import { render } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast/ToastContainer';

export * from '@testing-library/react';

/**
 * A React component that accepts only `children`. Used as the element type
 * for the `composeProviders` and `CORE_PROVIDERS` APIs so callers are
 * type-checked without reaching for `any`.
 */
export type ProviderComponent = React.ComponentType<{ children: ReactNode }>;

/**
 * Composes an array of provider components into a single wrapper component
 * using `reduceRight` so that the first element in the array becomes the
 * outermost provider (closest to the root).
 *
 * @param providers - Ordered list of provider components. First = outermost.
 * @returns A single `ProviderComponent` that wraps children in all providers.
 *
 * @example
 * const Wrapper = composeProviders([AuthProvider, ToastProvider]);
 * // renders as: <AuthProvider><ToastProvider>{children}</ToastProvider></AuthProvider>
 */
export function composeProviders(providers: ProviderComponent[]): ProviderComponent {
  return function ComposedProviders({ children }: { children: ReactNode }) {
    return providers.reduceRight<React.ReactElement>(
      (acc, Provider) => <Provider>{acc}</Provider>,
      <>{children}</>,
    );
  };
}

// NOTE: Keep only side-effect-free providers here. AuthProvider / VoiceInputProvider
// fire fetch calls inside useEffect and would pollute every test that uses this helper.
const CORE_PROVIDERS: ProviderComponent[] = [ToastProvider];

const AllProviders = composeProviders(CORE_PROVIDERS);

/**
 * Renders a component inside all globally required providers (currently
 * `ToastProvider`), ensuring contexts like `ToastContext` are available without
 * each test file managing provider setup.
 *
 * @param ui - The React element to render.
 * @param options - Optional `@testing-library/react` render options (excluding
 *   `wrapper`). Pass `providers` to opt-in additional providers on top of
 *   `CORE_PROVIDERS` — they are appended as inner wrappers.
 * @returns The result of `@testing-library/react`'s `render`.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { providers?: ProviderComponent[] },
) {
  const { providers, ...restOptions } = options ?? {};
  const wrapper =
    providers && providers.length > 0
      ? composeProviders([...CORE_PROVIDERS, ...providers])
      : AllProviders;
  return render(ui, { wrapper, ...restOptions });
}
