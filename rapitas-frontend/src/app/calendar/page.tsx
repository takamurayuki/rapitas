/**
 * CalendarPage
 *
 * Next.js page entry point for /calendar.
 * Delegates data fetching to useCalendarEvents and rendering to sub-components.
 */
'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Calendar as CalendarIcon, Coffee } from 'lucide-react';
import type { ScheduleEventInput, PaidLeaveBalance } from '@/types';
import { useToast } from '@/components/ui/toast/ToastContainer';
import ScheduleEventDialog from '@/feature/calendar/components/ScheduleEventDialog';
import PaidLeaveDialog from '@/feature/calendar/components/PaidLeaveDialog';
import { getHolidaysForMonth } from '@/utils/holidays';
import { useCalendarEvents } from './_hooks/useCalendarEvents';
import { CalendarGrid } from './_components/CalendarGrid';
import { DayEventsSidebar } from './_components/DayEventsSidebar';
import { CreateTaskModal } from './_components/CreateTaskModal';

export default function CalendarPage() {
  const t = useTranslations('calendar');
  const { showToast } = useToast();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showPaidLeaveModal, setShowPaidLeaveModal] = useState(false);

  const {
    events,
    loading,
    schedules,
    paidLeaveBalance,
    createTask,
    createScheduleEvent,
    createPaidLeave,
    deleteScheduleEvent,
  } = useCalendarEvents();

  const holidays = useMemo(
    () => getHolidaysForMonth(currentDate.getFullYear(), currentDate.getMonth()),
    [currentDate],
  );

  const holidayMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of holidays) map.set(h.date, h.name);
    return map;
  }, [holidays]);

  const prevMonth = () =>
    setCurrentDate(
      new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1),
    );

  const nextMonth = () =>
    setCurrentDate(
      new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1),
    );

  const goToToday = () => {
    const today = new Date();
    setCurrentDate(today);
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    setSelectedDate(`${year}-${month}-${day}`);
  };

  const handleTaskSubmit = async (title: string) => {
    if (!selectedDate) return;
    const ok = await createTask(title, selectedDate);
    if (ok) setShowCreateModal(false);
  };

  const handleScheduleSubmit = async (data: ScheduleEventInput) => {
    const ok = await createScheduleEvent(data);
    if (ok) setShowScheduleModal(false);
  };

  const handlePaidLeaveSubmit = async (data: ScheduleEventInput) => {
    const ok = await createPaidLeave(data);
    if (ok) setShowPaidLeaveModal(false);
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
          <div className="h-96 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <CalendarIcon className="w-8 h-8 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {t('title')}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t('subtitle')}
            </p>
          </div>
        </div>

        {/* Paid leave balance */}
        {paidLeaveBalance && (
          <PaidLeaveHeaderWidget
            balance={paidLeaveBalance}
            onRequest={() => {
              if (selectedDate) {
                setShowPaidLeaveModal(true);
              } else {
                showToast(t('selectDateForPaidLeave'), 'info');
              }
            }}
            t={t}
          />
        )}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <CalendarGrid
          currentDate={currentDate}
          events={events}
          schedules={schedules}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onDoubleClickDate={(dateStr) => {
            setSelectedDate(dateStr);
            setShowScheduleModal(true);
          }}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
          onGoToToday={goToToday}
        />

        <DayEventsSidebar
          selectedDate={selectedDate}
          events={events}
          schedules={schedules}
          holidayMap={holidayMap}
          onAddSchedule={() => setShowScheduleModal(true)}
          onAddTask={() => {
            if (selectedDate) setShowCreateModal(true);
          }}
          onAddPaidLeave={() => setShowPaidLeaveModal(true)}
          onDeleteSchedule={deleteScheduleEvent}
        />
      </div>

      {/* Modals */}
      {showCreateModal && selectedDate && (
        <CreateTaskModal
          selectedDate={selectedDate}
          onSubmit={handleTaskSubmit}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {showScheduleModal && selectedDate && (
        <ScheduleEventDialog
          selectedDate={selectedDate}
          onClose={() => setShowScheduleModal(false)}
          onSubmit={handleScheduleSubmit}
        />
      )}

      {showPaidLeaveModal && selectedDate && (
        <PaidLeaveDialog
          selectedDate={selectedDate}
          onClose={() => setShowPaidLeaveModal(false)}
          onSubmit={handlePaidLeaveSubmit}
          remainingDays={paidLeaveBalance?.remainingDays || 0}
        />
      )}
    </div>
  );
}

/**
 * Inline widget showing paid leave balance and request button.
 * Kept here because it is only rendered once and is tightly coupled to page state.
 */
function PaidLeaveHeaderWidget({
  balance,
  onRequest,
  t,
}: {
  balance: PaidLeaveBalance;
  onRequest: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('paidLeaveBalance')}
        </p>
        <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
          {t('paidLeaveDays', { count: balance.remainingDays })}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t('fiscalYear', { year: balance.fiscalYear })}
        </p>
      </div>
      <button
        onClick={onRequest}
        className="px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors text-sm font-medium flex items-center gap-2"
      >
        <Coffee className="w-4 h-4" />
        {t('paidLeaveRequest')}
      </button>
    </div>
  );
}
