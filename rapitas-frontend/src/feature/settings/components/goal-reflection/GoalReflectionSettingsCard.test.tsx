/**
 * GoalReflectionSettingsCard.test
 *
 * The nudge day/time card shows the saved value, saves a change, and reports a failure.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import ja from '../../../../../messages/ja.json';

const api = vi.hoisted(() => ({ getSettings: vi.fn(), saveSettings: vi.fn() }));
vi.mock('@/components/goal-reflection/goal-reflection-api', () => ({ goalReflectionApi: api }));

import GoalReflectionSettingsCard from './GoalReflectionSettingsCard';

function renderCard() {
  return render(
    <NextIntlClientProvider locale="ja" messages={ja} timeZone="Asia/Tokyo">
      <GoalReflectionSettingsCard />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getSettings.mockResolvedValue({ dow: 0, time: '20:00' });
  api.saveSettings.mockResolvedValue({ dow: 3, time: '07:30' });
});

describe('GoalReflectionSettingsCard', () => {
  it('shows the stored day and time', async () => {
    api.getSettings.mockResolvedValue({ dow: 5, time: '18:15' });
    renderCard();
    await waitFor(() =>
      expect((screen.getByLabelText('曜日') as HTMLSelectElement).value).toBe('5'),
    );
    expect((screen.getByLabelText('時刻') as HTMLInputElement).value).toBe('18:15');
  });

  it('saves the changed day and time', async () => {
    renderCard();
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('曜日'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('時刻'), { target: { value: '07:30' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ dow: 3, time: '07:30' }));
    expect(await screen.findByText('保存しました')).toBeTruthy();
  });

  it('reports a failed save', async () => {
    api.saveSettings.mockRejectedValue(new Error('x'));
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('保存できませんでした')).toBeTruthy();
  });
});
