/**
 * next-mocks
 *
 * Shared mock builders for Next.js libraries (next-intl, next/link, next/navigation).
 * Each builder returns a vi.mock()-compatible module object.
 * Not responsible for @/utils/api mocks — see api-mock.ts.
 */

import { vi } from 'vitest';

/**
 * Builds a mock for the `next-intl` module.
 *
 * useTranslations returns a translator that echoes the key back,
 * so no locale fixture is needed and interpolation calls are safe.
 *
 * @returns Module mock compatible with `vi.mock('next-intl', () => buildNextIntlMock())`
 */
export function buildNextIntlMock() {
  return {
    useTranslations: () => (key: string, _params?: unknown) => key,
  };
}

/**
 * Builds a mock for the `next/link` module.
 *
 * The default export renders a plain `<a>` tag that forwards href and all
 * other props (onClick, className, data-*, etc.) via rest spread.
 * This is the maximal-compatibility superset of all observed copy-paste variants.
 *
 * @returns Module mock compatible with `vi.mock('next/link', () => buildNextLinkMock())`
 */
export function buildNextLinkMock() {
  return {
    default: ({
      children,
      href,
      ...rest
    }: {
      children: React.ReactNode;
      href: string;
      [key: string]: unknown;
    }) => (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
  };
}

/**
 * Builds a mock for the `next/navigation` module.
 *
 * usePathname returns '/' by default (overridable).
 * useRouter returns push/replace as vi.fn() so call assertions work out of the box.
 *
 * @param overrides - Optional overrides: `pathname` replaces the usePathname return value.
 * @returns Module mock compatible with `vi.mock('next/navigation', () => buildNextNavigationMock())`
 */
export function buildNextNavigationMock(overrides?: { pathname?: string }) {
  return {
    usePathname: () => overrides?.pathname ?? '/',
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
    }),
  };
}
