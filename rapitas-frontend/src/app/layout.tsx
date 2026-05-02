import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
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
import OfflineIndicatorLoader from '@/components/common/OfflineIndicatorLoader';
import UpdateBanner from '@/components/common/UpdateBanner';
import GlobalErrorReporter from '@/components/common/GlobalErrorReporter';
import SetupGate from '@/components/common/SetupGate';
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
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* 
          SECURITY: This dangerouslySetInnerHTML is safe - it contains only 
          hardcoded static JavaScript for theme initialization. No user input.
        */}
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
        {/* 
          SECURITY: This dangerouslySetInnerHTML is safe - it contains only 
          hardcoded static JavaScript for service worker management. No user input.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Service worker policy:
              //  - production: register /sw.js for offline + asset caching
              //  - development (localhost / 127.0.0.1): skip registration AND
              //    proactively unregister any leftover SW + nuke its caches.
              //    Without this, the cache-first strategy in /sw.js keeps
              //    serving stale /_next/ chunks across code changes, forcing
              //    devs to "Clear site data" after every edit.
              if ('serviceWorker' in navigator) {
                var isLocalDev =
                  location.hostname === 'localhost' ||
                  location.hostname === '127.0.0.1' ||
                  location.hostname === '0.0.0.0' ||
                  location.hostname.endsWith('.local');
                if (isLocalDev) {
                  navigator.serviceWorker.getRegistrations().then(function (regs) {
                    regs.forEach(function (r) { r.unregister(); });
                  });
                  if (typeof caches !== 'undefined') {
                    caches.keys().then(function (keys) {
                      keys.forEach(function (k) { caches.delete(k); });
                    });
                  }
                } else {
                  window.addEventListener('load', function() {
                    navigator.serviceWorker.register('/sw.js').catch(function() {});
                  });
                }
              }
            `,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
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
                        <OfflineIndicatorLoader />
                      </Suspense>
                      <Suspense fallback={null}>
                        <ResumableExecutionsBanner />
                      </Suspense>
                      <Suspense fallback={null}>
                        <UpdateBanner />
                      </Suspense>
                      <GlobalErrorReporter />
                      <Suspense fallback={null}>
                        <SetupGate />
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
