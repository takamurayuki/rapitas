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
    // 分割表示が開始されることを事前に通知
    // これにより、UIコンポーネントが即座に位置調整を開始できる
    window.dispatchEvent(new CustomEvent('rapitas:split-view-preparing', {
      detail: { url: href }
    }));

    // UIコンポーネントの位置調整のための短い遅延を入れる
    requestAnimationFrame(() => {
      // Tauri環境では分割表示（メインウィンドウを右半分に、デフォルトブラウザを左側に表示）
      openExternalUrlInSplitView(href);
    });
  } else {
    // Web環境では通常の新しいタブで開く
    window.open(href, '_blank');
  }
}

/**
 * 外部リンクのクリックイベントを処理する
 */
export function handleExternalLinkClick(
  event: React.MouseEvent<HTMLAnchorElement> | MouseEvent,
  href: string
): void {
  // Ctrl/Cmd + クリックやミドルクリックの場合は通常の動作を維持
  if (event.ctrlKey || event.metaKey || event.button === 1) {
    return;
  }

  // 外部リンクの場合は分割表示で開く
  if (isExternalLink(href)) {
    // すべてのデフォルト動作を防ぐ
    event.preventDefault();
    event.stopPropagation();

    // ネイティブイベントの場合のみstopImmediatePropagationを呼び出す
    if ('stopImmediatePropagation' in event && typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }

    // 分割表示で開く
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

    // contentEditable内のリンクはスキップ（ノートエディタ等）
    if ((link as HTMLElement).isContentEditable) return;

    if (isExternalLink(href)) {
      // 古いイベントリスナーを削除（存在する場合）
      const existingHandler = (link as HTMLAnchorElement & { __externalLinkHandler?: EventListener }).__externalLinkHandler;
      if (existingHandler) {
        link.removeEventListener('click', existingHandler, true);
        delete (link as HTMLAnchorElement & { __externalLinkHandler?: EventListener }).__externalLinkHandler;
      }

      // 新しいイベントリスナーを作成（captureフェーズで実行して他のハンドラーより先に処理）
      const newHandler = (event: Event) => {
        handleExternalLinkClick(event as MouseEvent, href);
      };

      // イベントリスナーを登録（captureフェーズで実行）
      link.addEventListener('click', newHandler, true);

      // ハンドラーへの参照を保存（後で削除できるように）
      (link as HTMLAnchorElement & { __externalLinkHandler?: EventListener }).__externalLinkHandler = newHandler;

      // ハンドラー設定済みのマークを追加
      link.setAttribute('data-external-handler-set', 'true');

      // target="_blank"を削除（デフォルトのブラウザ動作を防ぐ）
      if (link.hasAttribute('target')) {
        link.removeAttribute('target');
      }
    }
  });
}