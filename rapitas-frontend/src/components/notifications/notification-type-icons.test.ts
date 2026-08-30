import { describe, expect, it } from 'vitest';
import {
  extractNotificationI18n,
  resolveNotificationIcon,
  resolveNotificationText,
} from './notification-type-icons';

describe('resolveNotificationIcon', () => {
  it('returns a mapped icon and color for a known type', () => {
    const { colorClass } = resolveNotificationIcon('task_created');
    expect(colorClass).toContain('indigo');
  });

  it('falls back to a neutral icon for an unknown type', () => {
    const known = resolveNotificationIcon('daily_report');
    const unknown = resolveNotificationIcon('some_future_type');
    expect(unknown.Icon).not.toBe(known.Icon);
    expect(unknown.colorClass).toContain('gray');
  });

  it('falls back for null/undefined type', () => {
    expect(resolveNotificationIcon(null).colorClass).toContain('gray');
    expect(resolveNotificationIcon(undefined).colorClass).toContain('gray');
  });
});

describe('extractNotificationI18n', () => {
  it('extracts from a JSON string metadata field', () => {
    const metadata = JSON.stringify({ i18n: { key: 'notification.types.task_completed.title' } });
    expect(extractNotificationI18n(metadata)).toEqual({
      key: 'notification.types.task_completed.title',
      params: undefined,
    });
  });

  it('extracts from an already-parsed object metadata field', () => {
    const metadata = { i18n: { key: 'notification.types.x.title', params: { a: 1 } } };
    expect(extractNotificationI18n(metadata)).toEqual({
      key: 'notification.types.x.title',
      params: { a: 1 },
    });
  });

  it('returns null when metadata is missing/null/unparseable', () => {
    expect(extractNotificationI18n(null)).toBeNull();
    expect(extractNotificationI18n(undefined)).toBeNull();
    expect(extractNotificationI18n('not-json')).toBeNull();
    expect(extractNotificationI18n('{}')).toBeNull();
  });
});

describe('resolveNotificationText', () => {
  it('translates via i18n metadata when present', () => {
    const t = (key: string, params?: Record<string, unknown>) =>
      key === 'notification.types.task_completed.title'
        ? 'Task completed'
        : `"${(params as { taskTitle: string }).taskTitle}" is done`;
    const notification = {
      title: 'legacy title',
      message: 'legacy message',
      metadata: JSON.stringify({
        i18n: { key: 'notification.types.task_completed.title', params: { taskTitle: 'Foo' } },
      }),
    };
    expect(resolveNotificationText(t, notification)).toEqual({
      title: 'Task completed',
      message: '"Foo" is done',
    });
  });

  it('falls back to stored title/message when i18n metadata is absent (legacy row)', () => {
    const t = () => 'should not be called';
    const notification = { title: 'legacy title', message: 'legacy message', metadata: null };
    expect(resolveNotificationText(t, notification)).toEqual({
      title: 'legacy title',
      message: 'legacy message',
    });
  });

  it('falls back to stored title/message when translation throws', () => {
    const t = () => {
      throw new Error('missing message');
    };
    const notification = {
      title: 'legacy title',
      message: 'legacy message',
      metadata: JSON.stringify({ i18n: { key: 'notification.types.unknown.title' } }),
    };
    expect(resolveNotificationText(t, notification)).toEqual({
      title: 'legacy title',
      message: 'legacy message',
    });
  });
});
