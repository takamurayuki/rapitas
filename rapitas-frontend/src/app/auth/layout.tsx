import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Authentication - Rapi+',
  description: 'ログイン・新規登録 - Rapi+',
};

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 認証ページ専用のレイアウト（ヘッダーなし、シンプルなレイアウト）
  return <>{children}</>;
}
