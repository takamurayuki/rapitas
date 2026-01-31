import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import KeyboardShortcuts from "@/components/KeyboardShortcuts";
import { FloatingAIMenuWrapper } from "@/components/floating-ai-menu";
import { Suspense } from "react";
import { ToastProvider } from "@/components/ui/toast/ToastContainer";
import { PomodoroProvider } from "@/feature/tasks/pomodoro/PomodoroProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Rapi+",
  description: "高パフォーマンスで直感的なUIのタスク管理アプリケーション",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <PomodoroProvider>
          <ToastProvider>
            <Suspense fallback={<div className="h-16" />}>
              <Header />
            </Suspense>
            {children}
            <Suspense fallback={null}>
              <KeyboardShortcuts />
            </Suspense>
            <FloatingAIMenuWrapper />
          </ToastProvider>
        </PomodoroProvider>
      </body>
    </html>
  );
}
