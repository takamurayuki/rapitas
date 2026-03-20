/**
 * schedule.types
 *
 * Type definitions for calendar/schedule events, paid leave management, and daily schedule blocks.
 */

export type ScheduleEventType = 'GENERAL' | 'PAID_LEAVE';

export type ScheduleEvent = {
  id: number;
  title: string;
  description?: string | null;
  startAt: string;
  endAt?: string | null;
  isAllDay: boolean;
  color: string;
  reminderMinutes?: number | null;
  reminderSentAt?: string | null;
  taskId?: number | null;
  type: ScheduleEventType;
  userId: string;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleEventInput = {
  title: string;
  description?: string;
  startAt: string;
  endAt?: string;
  isAllDay?: boolean;
  color?: string;
  reminderMinutes?: number | null;
  taskId?: number | null;
  type?: ScheduleEventType;
  userId?: string;
};

export type PaidLeaveBalance = {
  id: number;
  userId: string;
  totalDays: number;
  usedDays: number;
  remainingDays: number;
  fiscalYear: number;
  carryOverDays: number;
  lastCalculatedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type DailyScheduleBlock = {
  id: number;
  label: string;
  startTime: string;
  endTime: string;
  color: string;
  icon?: string | null;
  category: string;
  isNotify: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};
