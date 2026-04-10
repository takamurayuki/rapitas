import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import Header from '@/components/common/Header';
import KeyboardShortcuts from '@/components/common/KeyboardShortcuts';
import { ResumableExecutionsBanner } from '@/components/common/ResumableExecutionsBanner';
import ScheduleReminderProvider from '@/components/providers/ScheduleReminderProvider';
import { Suspense } from 'react';
import { ToastProvider } from '@/components/ui/toast/ToastContainer';
import { PomodoroProvider } from '@/feature/tasks/pomodoro/PomodoroProvider';
import ExternalLinksProvider from '@/components/providers/ExternalLinksProvider';
import NoteProvider from '@/components/note/NoteProvider';
import CacheWarmupInitializer from '@/components/common/CacheWarmupInitializer';
import SmartCommandBar from '@/components/smart-command-bar/SmartCommandBar';
import { AuthProvider } from '@/contexts/AuthContext';
import ConditionalHeader from '@/components/common/conditional-header';
import IntlProvider from '@/components/providers/IntlProvider';
import { VoiceInputProvider } from '@/components/voice';
import dynamic from 'next/dynamic';
// NOTE: OfflineIndicator uses useOfflineQueue which depends on IndexedDB
// (browser-only). Loading with ssr:false prevents hydration crashes.
const OfflineIndicator = dynamic(
  () => import('@/components/common/OfflineIndicator').then((m) => m.OfflineIndicator),
  { ssr: false },
);
// import WindowResizeOptimizer from '@/components/common/WindowResizeOptimizer';

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
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Rapi+',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#6366f1',
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
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').catch(function() {});
                });
              }
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
                <VoiceInputProvider>
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
                    <Suspense fallback={null}>
                      <OfflineIndicator />
                    </Suspense>
                    <Suspense fallback={null}>
                      <ResumableExecutionsBanner />
                    </Suspense>
                    <ScheduleReminderProvider />
                    <Suspense fallback={null}>
                      <NoteProvider />
                    </Suspense>
                    <CacheWarmupInitializer />
                    <Suspense fallback={null}>
                      <SmartCommandBar />
                    </Suspense>
                  </Suspense>
                </ExternalLinksProvider>
                </VoiceInputProvider>
              </ToastProvider>
            </PomodoroProvider>
          </AuthProvider>
        </IntlProvider>
      </body>
    </html>
  );
}
