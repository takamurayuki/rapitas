import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import Header from '@/components/Header';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import AchievementNotifications from '@/components/AchievementToast';
import { ResumableExecutionsBanner } from '@/components/ResumableExecutionsBanner';
import ScheduleReminderProvider from '@/components/ScheduleReminderProvider';
import { Suspense } from 'react';
import { ToastProvider } from '@/components/ui/toast/ToastContainer';
import { PomodoroProvider } from '@/feature/tasks/pomodoro/PomodoroProvider';
import ExternalLinksProvider from '@/components/ExternalLinksProvider';
import NoteProvider from '@/components/note/NoteProvider';
import CacheWarmupInitializer from '@/components/CacheWarmupInitializer';
import { AuthProvider } from '@/contexts/AuthContext';
import ConditionalHeader from '@/components/ConditionalHeader';
import IntlProvider from '@/components/IntlProvider';
// import WindowResizeOptimizer from '@/components/WindowResizeOptimizer';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Rapi+',
  description: '高パフォーマンスで直感的なUIのタスク管理アプリケーション',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const setClassOnDocumentBody = (darkMode) => {
                  document.documentElement.classList.toggle('dark', darkMode);
                };
                const localStorageTheme = localStorage.getItem('theme');
                if (localStorageTheme === 'dark') {
                  setClassOnDocumentBody(true);
                } else if (localStorageTheme === 'light') {
                  setClassOnDocumentBody(false);
                } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
                  setClassOnDocumentBody(true);
                }
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <IntlProvider>
          <AuthProvider>
            <PomodoroProvider>
              <ToastProvider>
                <ExternalLinksProvider>
                  <Suspense fallback={<div className="h-16" />}>
                    <Suspense fallback={<div className="h-16" />}>
                      <ConditionalHeader />
                    </Suspense>
                    {/* <WindowResizeOptimizer /> */}
                    {children}
                    <Suspense fallback={null}>
                      <KeyboardShortcuts />
                    </Suspense>
                    <AchievementNotifications />
                    <Suspense fallback={null}>
                      <ResumableExecutionsBanner />
                    </Suspense>
                    <ScheduleReminderProvider />
                    <Suspense fallback={null}>
                      <NoteProvider />
                    </Suspense>
                    <CacheWarmupInitializer />
                  </Suspense>
                </ExternalLinksProvider>
              </ToastProvider>
            </PomodoroProvider>
          </AuthProvider>
        </IntlProvider>
      </body>
    </html>
  );
}
