/**
 * DayEventsSidebar.readonly.test
 *
 * Someone else's shared calendar offers nothing that would write to it
 * (#1270).
 *
 * The server refuses the writes either way — no share route touches a
 * schedule event — so what these tests protect is the user: a visible
 * 「予定を追加」 on a calendar that is not yours is a button that can only
 * disappoint, and a delete icon beside someone else's meeting is worse.
 *
 * The events themselves must still render, which is the other half: hiding
 * the controls by hiding the panel would be the easy wrong fix.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DayEventsSidebar } from '../DayEventsSidebar';
import type { CalendarEvent } from '../../_utils/calendar-helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

const EVENTS: CalendarEvent[] = [
  { id: 1, title: '相手の会議', date: '2026-01-05', type: 'schedule', color: '#4f46e5' },
];

const props = {
  selectedDate: '2026-01-05',
  events: EVENTS,
  schedules: [],
  holidayMap: new Map(),
  onAddSchedule: vi.fn(),
  onAddTask: vi.fn(),
  onAddPaidLeave: vi.fn(),
  onDeleteSchedule: vi.fn(),
};

describe('the sidebar on my own calendar', () => {
  it('offers the ways to add something', () => {
    render(<DayEventsSidebar {...props} />);
    expect(screen.getByText('addScheduleShort')).toBeInTheDocument();
    expect(screen.getByText('addTaskShort')).toBeInTheDocument();
    expect(screen.getByText('paidLeaveShort')).toBeInTheDocument();
  });

  it('offers to delete a schedule', () => {
    render(<DayEventsSidebar {...props} />);
    expect(screen.getByTitle('delete')).toBeInTheDocument();
  });
});

describe('the sidebar on a shared calendar', () => {
  it('still shows what is on that day', () => {
    render(<DayEventsSidebar {...props} readOnly />);
    expect(screen.getByText('相手の会議')).toBeInTheDocument();
  });

  it('offers no way to add anything', () => {
    render(<DayEventsSidebar {...props} readOnly />);
    expect(screen.queryByText('addScheduleShort')).not.toBeInTheDocument();
    expect(screen.queryByText('addTaskShort')).not.toBeInTheDocument();
    expect(screen.queryByText('paidLeaveShort')).not.toBeInTheDocument();
  });

  it('offers no way to delete what is not mine', () => {
    render(<DayEventsSidebar {...props} readOnly />);
    expect(screen.queryByTitle('delete')).not.toBeInTheDocument();
  });

  it('offers nothing in the empty state either', () => {
    // The day with nothing on it is where the calls to action are largest.
    render(<DayEventsSidebar {...props} events={[]} readOnly />);
    expect(screen.getByText('noEventsOnDay')).toBeInTheDocument();
    expect(screen.queryByText('addSchedule')).not.toBeInTheDocument();
    expect(screen.queryByText('paidLeaveRequest')).not.toBeInTheDocument();
    expect(screen.queryByText('addTask')).not.toBeInTheDocument();
  });
});
