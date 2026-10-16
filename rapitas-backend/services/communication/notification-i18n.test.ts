import { describe, expect, test } from 'bun:test';
import { buildNotificationI18n } from './notification-i18n';

describe('buildNotificationI18n', () => {
  test('builds a title key with no params when none are given', () => {
    expect(buildNotificationI18n('task_completed')).toEqual({
      key: 'notification.types.task_completed.title',
    });
  });

  test('includes cleaned params when given', () => {
    expect(buildNotificationI18n('auto_run_hang_backstop', { taskId: 1, wallMinutes: 30 })).toEqual(
      {
        key: 'notification.types.auto_run_hang_backstop.title',
        params: { taskId: 1, wallMinutes: 30 },
      },
    );
  });

  test('drops undefined and null param values', () => {
    expect(
      buildNotificationI18n('auto_run_queue_starved', {
        waitedMinutes: 5,
        taskId: undefined,
        extra: null,
      }),
    ).toEqual({
      key: 'notification.types.auto_run_queue_starved.title',
      params: { waitedMinutes: 5 },
    });
  });

  test('omits params entirely when all values are dropped', () => {
    expect(buildNotificationI18n('daily_report', { date: undefined })).toEqual({
      key: 'notification.types.daily_report.title',
    });
  });
});
