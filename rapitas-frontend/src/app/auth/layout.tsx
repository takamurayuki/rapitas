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
  // Auth pages use a minimal layout without the global header
  return <>{children}</>;
}
