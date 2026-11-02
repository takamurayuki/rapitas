/**
 * UserDatabaseCard.test (#1285)
 *
 * The card's safety rails: the URL field is a password field, initialize is
 * disabled until the "local data is not migrated" box is ticked, and the
 * state line tells local / saved / initialized / active apart.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ja from '../../../../../../messages/ja.json';
import { UserDatabaseCard } from '../UserDatabaseCard';

const hook = {
  status: null as null | {
    configured: boolean;
    url: string | null;
    initializedAt: string | null;
    active: boolean;
  },
  latency: null,
  busy: null,
  error: null,
  restartRequired: false,
  save: vi.fn(async () => {}),
  measure: vi.fn(async () => {}),
  initialize: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
};
vi.mock('../use-user-database', () => ({ useUserDatabase: () => hook }));

const renderCard = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={ja}>
      <UserDatabaseCard />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  hook.status = { configured: false, url: null, initializedAt: null, active: false };
  hook.initialize.mockClear();
});

describe('UserDatabaseCard', () => {
  it('the connection string is entered in a password field', () => {
    renderCard();
    expect((screen.getByLabelText('接続文字列（postgresql://…）') as HTMLInputElement).type).toBe(
      'password',
    );
  });

  it('initialize stays disabled until the warning is acknowledged', () => {
    hook.status = {
      configured: true,
      url: 'postgresql://a:***@h/db',
      initializedAt: null,
      active: false,
    };
    renderCard();
    const button = screen.getByRole('button', { name: '初期化する' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('理解しました'));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(hook.initialize).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      { configured: false, url: null, initializedAt: null, active: false },
      'この端末のデータベースを使用中',
    ],
    [{ configured: true, url: 'x', initializedAt: null, active: false }, '保存済み・未初期化'],
    [
      { configured: true, url: 'x', initializedAt: '2026-11-03', active: false },
      '初期化済み・次回起動から使用',
    ],
    [
      { configured: true, url: 'x', initializedAt: '2026-11-03', active: true },
      'このデータベースを使用中',
    ],
  ])('state line for %o', (status, text) => {
    hook.status = status;
    renderCard();
    expect(screen.getByTestId('user-db-state').textContent).toContain(text);
  });
});
