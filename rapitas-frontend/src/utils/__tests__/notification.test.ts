import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  requestNotificationPermission,
  showDesktopNotification,
} from '../notification';

describe('requestNotificationPermission', () => {
  const originalNotification = window.Notification;

  afterEach(() => {
    window.Notification = originalNotification;
  });

  it('returns false when Notification API is not available', async () => {
    // @ts-expect-error removing Notification for test
    delete window.Notification;
    expect(await requestNotificationPermission()).toBe(false);
  });

  it('returns true when already granted', async () => {
    // @ts-expect-error mock Notification
    window.Notification = { permission: 'granted' };
    expect(await requestNotificationPermission()).toBe(true);
  });

  it('returns false when denied', async () => {
    // @ts-expect-error mock Notification
    window.Notification = { permission: 'denied' };
    expect(await requestNotificationPermission()).toBe(false);
  });

  it('requests permission when default', async () => {
    // @ts-expect-error mock Notification
    window.Notification = {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    };
    expect(await requestNotificationPermission()).toBe(true);
  });
});

describe('showDesktopNotification', () => {
  const originalNotification = window.Notification;

  afterEach(() => {
    window.Notification = originalNotification;
  });

  it('returns null when Notification API is not available', () => {
    // @ts-expect-error removing Notification for test
    delete window.Notification;
    expect(showDesktopNotification('Test')).toBeNull();
  });

  it('returns null when permission is not granted', () => {
    // @ts-expect-error mock Notification
    window.Notification = class {
      static permission = 'denied';
    };
    expect(showDesktopNotification('Test')).toBeNull();
  });

  it('creates notification when permission is granted', () => {
    let constructorArgs: [string, NotificationOptions?] = ['', undefined];
    class MockNotification {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      constructor(title: string, options?: NotificationOptions) {
        constructorArgs = [title, options];
      }
      close() {}
    }
    // @ts-expect-error mock Notification class
    window.Notification = MockNotification;

    const result = showDesktopNotification('Hello', { body: 'World' });
    expect(result).toBeInstanceOf(MockNotification);
    expect(constructorArgs[0]).toBe('Hello');
    expect(constructorArgs[1]?.body).toBe('World');
  });
});
