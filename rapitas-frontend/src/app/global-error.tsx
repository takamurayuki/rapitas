'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error:', error);
  }, [error]);

  return (
    <html lang="ja">
      <body>
        <div
          style={{
            display: 'flex',
            minHeight: '100vh',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'sans-serif',
            padding: '1rem',
          }}
        >
          <div
            style={{
              maxWidth: '28rem',
              textAlign: 'center',
              padding: '2rem',
              border: '1px solid #fca5a5',
              borderRadius: '0.5rem',
              backgroundColor: '#fef2f2',
            }}
          >
            <h2
              style={{
                fontSize: '1.25rem',
                fontWeight: 600,
                color: '#991b1b',
                marginBottom: '0.5rem',
              }}
            >
              重大なエラーが発生しました
            </h2>
            <p
              style={{
                fontSize: '0.875rem',
                color: '#dc2626',
                marginBottom: '1.5rem',
              }}
            >
              アプリケーションの初期化中にエラーが発生しました。
            </p>
            <button
              onClick={reset}
              style={{
                padding: '0.5rem 1.5rem',
                backgroundColor: '#dc2626',
                color: 'white',
                border: 'none',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              再読み込み
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
