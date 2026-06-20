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
 * Wraps the component tree with all globally required React context providers.
 * Currently includes: ToastProvider.
 * Add future providers here so every test automatically receives them.
 *
 * @param children - The component tree to wrap.
 * @returns JSX with all providers applied.
 */
function AllProviders({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

/**
 * Renders a component inside `AllProviders`, ensuring contexts like ToastContext
 * are available without each test file managing provider setup.
 *
 * @param ui - The React element to render.
 * @param options - Optional `@testing-library/react` render options (excluding `wrapper`).
 * @returns The result of `@testing-library/react`'s `render`.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, { wrapper: AllProviders, ...options });
}
