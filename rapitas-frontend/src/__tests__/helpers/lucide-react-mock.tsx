/**
 * lucide-react-mock
 *
 * Shared self-repairing mock factory for lucide-react.
 * Stubs every real export automatically so newly-added icons never break tests.
 * Use inside vi.mock() via a dynamic import to avoid Vitest hoist conflicts.
 */

/**
 * Builds a complete lucide-react mock that stubs every real export.
 *
 * Usage inside vi.mock():
 * ```tsx
 * vi.mock('lucide-react', async (importOriginal) => {
 *   const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
 *   return buildLucideMock(importOriginal, { Menu: 'menu-icon', Sun: 'sun-icon' });
 * });
 * ```
 *
 * @param importOriginal - Vitest's importOriginal callback (supplies the real module)
 * @param overrides - Icon name → custom data-testid. Unnamed exports fall back to `${key}-icon`.
 * @returns Mocked module object (every export is a stub div component)
 */
export async function buildLucideMock(
  importOriginal: () => Promise<unknown>,
  overrides: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const actual = (await importOriginal()) as Record<string, unknown>;

  const createIcon = (testId: string) => {
    const Icon = ({ className }: { className?: string }) => (
      <div data-testid={testId} className={className} />
    );
    Icon.displayName = testId;
    return Icon;
  };

  const mocked: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    mocked[key] = createIcon(overrides[key] ?? `${key}-icon`);
  }

  return mocked;
}
