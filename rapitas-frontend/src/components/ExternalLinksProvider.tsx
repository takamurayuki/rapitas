"use client";
import { useEffect } from 'react';
import { setupExternalLinkHandlers } from '@/utils/external-links';

interface ExternalLinksProviderProps {
  children: React.ReactNode;
}

/**
 * 外部リンクの分割表示処理をグローバルに適用するプロバイダー
 * ページ読み込み時と動的コンテンツ変更時に外部リンクハンドラーを設定
 */
export default function ExternalLinksProvider({ children }: ExternalLinksProviderProps) {
  useEffect(() => {
    // 初期読み込み時にハンドラーを設定
    setupExternalLinkHandlers();

    // MutationObserverを使って動的に追加されるリンクも監視
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        // 新しいノードが追加された場合のみ処理
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // 少し遅延させてからハンドラーを設定（React の更新が完了してから）
          setTimeout(() => {
            setupExternalLinkHandlers();
          }, 100);
        }
      });
    });

    // DOM全体を監視
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // クリーンアップ
    return () => {
      observer.disconnect();
    };
  }, []);

  return <>{children}</>;
}