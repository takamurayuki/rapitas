import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestNotificationPermission, showDesktopNotification } from '../notification';

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

  it('defaults the icon when none is provided', () => {
    let constructorArgs: [string, NotificationOptions?] = ['', undefined];
    class MockNotification {
      static permission = 'granted';
      constructor(title: string, options?: NotificationOptions) {
        constructorArgs = [title, options];
      }
      close() {}
    }
    // @ts-expect-error mock Notification class
    window.Notification = MockNotification;

    showDesktopNotification('Hello');

    expect(constructorArgs[1]?.icon).toBe('/icons/icon.ico');
  });

  it('wires onClick to focus the window, invoke the callback, then close the notification', () => {
    const closeSpy = vi.fn();
    class MockNotification {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      constructor(
        public title: string,
        public options?: NotificationOptions,
      ) {}
      close = closeSpy;
    }
    // @ts-expect-error mock Notification class
    window.Notification = MockNotification;
    const focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {});
    const onClick = vi.fn();

    const result = showDesktopNotification('Hello', { onClick });
    result?.onclick?.(new Event('click'));

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    focusSpy.mockRestore();
  });

  it('does not set onclick when no onClick callback is given', () => {
    class MockNotification {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      constructor(
        public title: string,
        public options?: NotificationOptions,
      ) {}
      close() {}
    }
    // @ts-expect-error mock Notification class
    window.Notification = MockNotification;

    const result = showDesktopNotification('Hello');

    expect(result?.onclick).toBeNull();
  });
});
