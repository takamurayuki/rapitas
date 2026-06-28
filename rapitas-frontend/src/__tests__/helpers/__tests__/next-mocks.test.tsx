/**
 * next-mocks.test
 *
 * Unit tests for next-mocks (next-intl, next/link, next/navigation)
 * and api-mock shared test helpers.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { buildNextIntlMock, buildNextLinkMock, buildNextNavigationMock } from '../next-mocks';
import { buildApiMock } from '../api-mock';

describe('buildNextIntlMock', () => {
  it('useTranslations がキーをそのまま返す', () => {
    const { useTranslations } = buildNextIntlMock();
    const t = useTranslations();
    expect(t('myKey')).toBe('myKey');
  });

  it('補間付き呼び出しでも例外を出さずキーを返す', () => {
    const { useTranslations } = buildNextIntlMock();
    const t = useTranslations();
    // NOTE: Interpolation values are ignored — mock always echoes the key.
    expect(t('greeting', { name: 'Alice' })).toBe('greeting');
  });

  it('空文字キーも正常に返す', () => {
    const { useTranslations } = buildNextIntlMock();
    const t = useTranslations();
    expect(t('')).toBe('');
  });
});

describe('buildNextLinkMock', () => {
  it('href と children が正しく透過される', () => {
    const { default: Link } = buildNextLinkMock();
    render(<Link href="/foo">Click</Link>);
    const anchor = screen.getByRole('link', { name: 'Click' });
    expect(anchor).toHaveAttribute('href', '/foo');
  });

  it('onClick が透過される', () => {
    const { default: Link } = buildNextLinkMock();
    const onClick = vi.fn();
    render(
      <Link href="/bar" onClick={onClick}>
        Btn
      </Link>,
    );
    fireEvent.click(screen.getByRole('link'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('className が透過される', () => {
    const { default: Link } = buildNextLinkMock();
    render(
      <Link href="/baz" className="my-class">
        X
      </Link>,
    );
    expect(screen.getByRole('link')).toHaveClass('my-class');
  });

  it('任意の data-* 属性が透過される', () => {
    const { default: Link } = buildNextLinkMock();
    render(
      <Link href="/x" data-custom="yes">
        Y
      </Link>,
    );
    expect(screen.getByRole('link')).toHaveAttribute('data-custom', 'yes');
  });

  it('href のみの最小構成でも動作する', () => {
    const { default: Link } = buildNextLinkMock();
    render(<Link href="/min">Min</Link>);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/min');
  });
});

describe('buildNextNavigationMock', () => {
  it('usePathname がデフォルトで "/" を返す', () => {
    const { usePathname } = buildNextNavigationMock();
    expect(usePathname()).toBe('/');
  });

  it('overrides で pathname を上書きできる', () => {
    const { usePathname } = buildNextNavigationMock({ pathname: '/tasks' });
    expect(usePathname()).toBe('/tasks');
  });

  it('useRouter の push が vi.fn である', () => {
    const { useRouter } = buildNextNavigationMock();
    const router = useRouter();
    router.push('/test');
    expect(router.push).toHaveBeenCalledWith('/test');
  });

  it('useRouter の replace が vi.fn である', () => {
    const { useRouter } = buildNextNavigationMock();
    const router = useRouter();
    router.replace('/other');
    expect(router.replace).toHaveBeenCalledWith('/other');
  });

  it('overrides なしで useRouter の vi.fn は独立している', () => {
    const { useRouter: router1 } = buildNextNavigationMock();
    const { useRouter: router2 } = buildNextNavigationMock();
    router1().push('/a');
    // NOTE: each buildNextNavigationMock call creates fresh vi.fn instances
    expect(router2().push).not.toHaveBeenCalled();
  });
});

describe('buildApiMock', () => {
  it('デフォルトは http://test:3001 を返す', () => {
    const mock = buildApiMock();
    expect(mock.API_BASE_URL).toBe('http://test:3001');
  });

  it('引数で URL を上書きできる', () => {
    const mock = buildApiMock('http://test');
    expect(mock.API_BASE_URL).toBe('http://test');
  });

  it('任意の URL 文字列を受け付ける', () => {
    const mock = buildApiMock('https://api.example.com');
    expect(mock.API_BASE_URL).toBe('https://api.example.com');
  });
});
