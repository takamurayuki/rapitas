/**
 * PC通知（デスクトップ通知）のユーティリティ
 * ブラウザのNotification APIを使用
 */

/**
 * 通知権限をリクエスト
 * @returns 許可されたかどうか
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission === 'denied') {
    return false;
  }

  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

/**
 * PC通知を表示
 * @param title 通知タイトル
 * @param options 通知オプション
 */
export function showDesktopNotification(
  title: string,
  options?: {
    body?: string;
    icon?: string;
    tag?: string;
    onClick?: () => void;
  },
): Notification | null {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return null;
  }

  if (Notification.permission !== 'granted') {
    return null;
  }

  const notification = new Notification(title, {
    body: options?.body,
    icon: options?.icon || '/icons/icon.ico',
    tag: options?.tag,
  });

  if (options?.onClick) {
    notification.onclick = () => {
      window.focus();
      options.onClick?.();
      notification.close();
    };
  }

  return notification;
}
