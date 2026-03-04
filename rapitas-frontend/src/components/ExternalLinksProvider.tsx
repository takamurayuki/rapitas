'use client';
import { useEffect } from 'react';
import { setupExternalLinkHandlers } from '@/utils/external-links';
import { useSplitViewExit } from '@/hooks/use-split-view-exit';

interface ExternalLinksProviderProps {
  children: React.ReactNode;
}

/**
 * 外部リンクの分割表示処理をグローバルに適用するプロバイダー
 * ページ読み込み時と動的コンテンツ変更時に外部リンクハンドラーを設定
 * Escキーで分割表示を終了する機能も提供
 */
export default function ExternalLinksProvider({
  children,
}: ExternalLinksProviderProps) {
  // 分割表示の終了機能を有効化
  useSplitViewExit();

  useEffect(() => {
    // 初期読み込み時にハンドラーを設定
    setupExternalLinkHandlers();

    // デバウンス用のタイマー
    let debounceTimer: NodeJS.Timeout | null = null;

    // MutationObserverを使って動的に追加されるリンクも監視
    const observer = new MutationObserver((mutations) => {
      // リンクを含む可能性のある新しいノードがあるかチェック
      const hasNewLinks = mutations.some((mutation) => {
        if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) {
          return false;
        }

        // 追加されたノードの中にaタグが含まれているかチェック
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            if (element.tagName === 'A' || element.querySelector('a')) {
              return true;
            }
          }
        }
        return false;
      });

      if (hasNewLinks) {
        // 既存のタイマーをクリア
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        // デバウンスして実行（短期間に複数回の変更があっても一度だけ実行）
        debounceTimer = setTimeout(() => {
          setupExternalLinkHandlers();
          debounceTimer = null;
        }, 100);
      }
    });

    // DOM全体を監視
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // クリーンアップ
    return () => {
      observer.disconnect();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, []);

  return <>{children}</>;
}
