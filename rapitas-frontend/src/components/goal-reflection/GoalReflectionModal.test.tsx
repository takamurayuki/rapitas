/**
 * GoalReflectionModal.test
 *
 * The weekly reflection modal: pick a rating and write a note per goal; this
 * week's saved record is shown again and can be corrected; a rating is needed
 * to save; every string comes from the message catalogue.
 */
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import ja from '../../../messages/ja.json';
import en from '../../../messages/en.json';

const api = vi.hoisted(() => ({
  openGoals: vi.fn(),
  list: vi.fn(),
  save: vi.fn(),
}));
vi.mock('./goal-reflection-api', () => ({ goalReflectionApi: api }));

import GoalReflectionModal from './GoalReflectionModal';
import { useGoalReflectionModalStore } from './goal-reflection-store';
import { currentWeekStart } from './goal-reflection-week';

function renderModal(messages: object = ja, locale = 'ja') {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Tokyo">
      <GoalReflectionModal />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useGoalReflectionModalStore.setState({ isOpen: true });
  api.openGoals.mockResolvedValue([
    { id: 1, name: '英語' },
    { id: 2, name: '資格' },
  ]);
  api.list.mockResolvedValue([]);
  api.save.mockResolvedValue({});
});

// A cold render of the modal can exceed the 5s default on a loaded machine.
vi.setConfig({ testTimeout: 20000 });

describe('GoalReflectionModal', () => {
  it('lists the goals in progress with no rating chosen and Save disabled', async () => {
    renderModal();
    expect(await screen.findByText('英語')).toBeTruthy();
    expect(screen.getByText('資格')).toBeTruthy();
    expect((screen.getByRole('button', { name: '保存する' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('saves the chosen rating and note for that goal only', async () => {
    renderModal();
    await screen.findByText('英語');
    const group = screen.getByRole('radiogroup', { name: '英語 の今週の前進' });
    fireEvent.click(group.querySelectorAll('button')[3]); // 4
    fireEvent.change(screen.getAllByPlaceholderText('一言（任意）')[0], {
      target: { value: '過去問を解いた' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.save).toHaveBeenCalledWith(1, 4, '過去問を解いた');
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it("shows this week's saved record and lets it be corrected", async () => {
    api.list.mockImplementation(async (id: number) =>
      id === 1
        ? [
            { projectId: 1, weekStart: '2000-01-03', rating: 1, note: '古い週', updatedAt: '' },
            {
              projectId: 1,
              weekStart: currentWeekStart(new Date()),
              rating: 2,
              note: 'ぼちぼち',
              updatedAt: '',
            },
          ]
        : [],
    );
    renderModal();
    await screen.findByText('英語');
    expect((screen.getAllByPlaceholderText('一言（任意）')[0] as HTMLTextAreaElement).value).toBe(
      'ぼちぼち',
    );
    const group = screen.getByRole('radiogroup', { name: '英語 の今週の前進' });
    expect(group.querySelectorAll('button')[1].getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('記録済み')).toBeTruthy();

    fireEvent.click(group.querySelectorAll('button')[4]); // correct to 5
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(1, 5, 'ぼちぼち'));
  });

  it('keeps a failed row savable and says so', async () => {
    api.save.mockRejectedValue(new Error('boom'));
    renderModal();
    await screen.findByText('英語');
    fireEvent.click(
      screen.getByRole('radiogroup', { name: '英語 の今週の前進' }).querySelectorAll('button')[2],
    );
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    expect(await screen.findByText('保存できませんでした。')).toBeTruthy();
    expect((screen.getByRole('button', { name: '保存する' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('保存中に選び直した評価を記録済みと表示せず再保存できる', async () => {
    let resolve!: (value: unknown) => void;
    api.save.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderModal();
    await screen.findByText('英語');
    const group = screen.getByRole('radiogroup', { name: '英語 の今週の前進' });
    fireEvent.click(group.querySelectorAll('button')[1]);
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    fireEvent.click(group.querySelectorAll('button')[4]);
    await act(async () => {
      resolve({});
    });
    expect(group.querySelectorAll('button')[4].getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('記録済み')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect((screen.getByRole('button', { name: '保存する' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    await waitFor(() => expect(api.save).toHaveBeenNthCalledWith(2, 1, 5, ''));
    expect(await screen.findByText('記録済み')).toBeTruthy();
  });

  it('refuses to save a note over 500 characters', async () => {
    renderModal();
    await screen.findByText('英語');
    fireEvent.click(
      screen.getByRole('radiogroup', { name: '英語 の今週の前進' }).querySelectorAll('button')[2],
    );
    fireEvent.change(screen.getAllByPlaceholderText('一言（任意）')[0], {
      target: { value: 'あ'.repeat(501) },
    });
    expect((screen.getByRole('button', { name: '保存する' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText('501 / 500')).toBeTruthy();
  });

  it('says so when no goal is in progress', async () => {
    api.openGoals.mockResolvedValue([]);
    renderModal();
    expect(await screen.findByText(/進行中のゴールがありません/)).toBeTruthy();
  });

  it('reports a load failure', async () => {
    api.openGoals.mockRejectedValue(new Error('down'));
    renderModal();
    expect(await screen.findByText('振り返りを読み込めませんでした。')).toBeTruthy();
  });

  it('renders from the English catalogue without missing keys', async () => {
    renderModal(en, 'en');
    expect(await screen.findByText("Reflect on this week's progress")).toBeTruthy();
    await screen.findByText('英語');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});
