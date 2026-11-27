/**
 * InsightsClient.test
 *
 * With no material the page says 「まだ材料がありません」 and never shows 0%;
 * with material it shows the rate with numerator and denominator.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import ja from '../../../../../messages/ja.json';
import type { InsightMetric, InsightsResponse } from '../_hooks/insights.types';

const state: { data: InsightsResponse | null; period: string } = { data: null, period: '4w' };
const setPeriod = vi.fn();
vi.mock('../_hooks/useGoalInsights', () => ({
  useGoalInsights: () => ({
    data: state.data,
    isLoading: false,
    error: null,
    period: state.period,
    setPeriod,
  }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import InsightsClient from '../_components/InsightsClient';

const empty: InsightMetric = { numerator: 0, denominator: 0, rate: null, reason: 'no-material' };
const felt: InsightMetric = { ...empty, reason: 'no-reflection-source' };
const metrics = (over: Partial<Record<string, InsightMetric>> = {}) => ({
  reachRate: empty,
  resumeRate: empty,
  quality: empty,
  feltProgress: felt,
  ...over,
});

function renderPage() {
  return render(
    <NextIntlClientProvider locale="ja" messages={ja} timeZone="Asia/Tokyo">
      <InsightsClient />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  setPeriod.mockClear();
  state.period = '4w';
});

describe('InsightsClient', () => {
  it('says there is no material yet and never shows 0% when every metric is empty', () => {
    state.data = { period: '4w', overall: metrics(), goals: [] };
    renderPage();
    // Three empty metrics plus the empty goal list.
    expect(screen.getAllByText('まだ材料がありません')).toHaveLength(4);
    expect(screen.getByText('週1回の振り返りがまだ無いため、データなしです')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/0%/);
  });

  it('shows a rate with its numerator and denominator', () => {
    state.data = {
      period: '4w',
      overall: metrics({
        reachRate: { numerator: 3, denominator: 4, rate: 0.75, reason: null },
        quality: { numerator: 0, denominator: 2, rate: 0, reason: null },
      }),
      goals: [],
    };
    renderPage();
    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.getByText('3 / 4')).toBeTruthy();
    // A real 0% (material exists, none kept) is shown, unlike no material.
    expect(screen.getByText('0%')).toBeTruthy();
    expect(screen.getByText('0 / 2')).toBeTruthy();
  });

  it('switches the period', () => {
    state.data = { period: '4w', overall: metrics(), goals: [] };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '全期間' }));
    expect(setPeriod).toHaveBeenCalledWith('all');
  });

  it('lists each goal with its counts and a stalled badge, and no area filter', () => {
    state.data = {
      period: '4w',
      overall: metrics(),
      goals: [
        {
          id: 1,
          name: '資格',
          reached: 1,
          open: 2,
          paused: 0,
          lastUpdatedAt: '2026-11-01T00:00:00.000Z',
          stalled: true,
        },
        {
          id: 2,
          name: '運動',
          reached: 0,
          open: 1,
          paused: 1,
          lastUpdatedAt: '2026-11-25T00:00:00.000Z',
          stalled: false,
        },
      ],
    };
    renderPage();
    expect(screen.getByText('資格')).toBeTruthy();
    expect(screen.getByText('到達 1 / 未到達 2 / 休止 0', { exact: false })).toBeTruthy();
    expect(screen.getByText('最終更新 2026/11/01', { exact: false })).toBeTruthy();
    expect(screen.getByText('最終更新 2026/11/25', { exact: false })).toBeTruthy();
    expect(screen.getAllByText('停滞中')).toHaveLength(1);
    expect(screen.getAllByText('進行中')).toHaveLength(1);
    expect(screen.queryByRole('group', { name: '分野' })).toBeNull();
  });

  it('says so when there are no goals', () => {
    state.data = { period: '4w', overall: metrics(), goals: [] };
    renderPage();
    expect(screen.getAllByText('まだ材料がありません').length).toBeGreaterThan(3);
    expect(screen.getByText(/最終更新時刻から推定/)).toBeTruthy();
  });
});
