/**
 * 外部リンク関連のユーティリティ関数
 */
import { isTauri, openExternalUrlInSplitView } from '@/utils/tauri';

/**
 * URLが外部リンクかどうかを判定する
 */
export function isExternalLink(href: string): boolean {
  try {
    // 相対リンク、アンカーリンク、メールリンクは内部扱い
    if (
      href.startsWith('/') ||
      href.startsWith('#') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:')
    ) {
      return false;
    }

    const url = new URL(href);
    const currentHost = window.location.hostname;

    // 同じドメインの場合は内部リンク扱い
    return url.hostname !== currentHost;
  } catch {
    // URLの解析に失敗した場合は内部リンク扱い
    return false;
  }
}

/**
 * 外部リンクを分割表示で開く（Web環境とTauri環境の両方で対応）
 */
export function openExternalLinkInSplitView(href: string): void {
  if (isTauri()) {
    // Tauri環境では分割表示（メインウィンドウを右半分に、デフォルトブラウザを左側に表示）
    openExternalUrlInSplitView(href);
  } else {
    // Web環境では通常の新しいタブで開く
    window.open(href, '_blank');
  }
}

/**
 * 外部リンクのクリックイベントを処理する
 */
export function handleExternalLinkClick(
  event: React.MouseEvent<HTMLAnchorElement>,
  href: string
): void {
  // Ctrl/Cmd + クリックやミドルクリックの場合は通常の動作を維持
  if (event.ctrlKey || event.metaKey || event.button === 1) {
    return;
  }

  // 外部リンクの場合は分割表示で開く
  if (isExternalLink(href)) {
    event.preventDefault();
    openExternalLinkInSplitView(href);
  }
}

/**
 * linkタグやaタグに自動的にクリックハンドラーを設定する
 */
export function setupExternalLinkHandlers(): void {
  const links = document.querySelectorAll('a[href]');

  links.forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;

    // すでにハンドラーが設定されている場合はスキップ
    if (link.hasAttribute('data-external-handler-set')) return;

    if (isExternalLink(href)) {
      link.addEventListener('click', (event) => {
        handleExternalLinkClick(event as any, href);
      });

      // ハンドラー設定済みのマークを追加
      link.setAttribute('data-external-handler-set', 'true');
    }
  });
}