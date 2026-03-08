'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Eye, EyeOff, LogIn, User, Lock, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

// Google アイコンコンポーネント
function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { login, loginWithGoogle, isAuthenticated, isLoading } = useAuth();
  const t = useTranslations('auth');
  const tc = useTranslations('common');

  const [formData, setFormData] = useState({
    username: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // 既にログイン済みの場合はリダイレクト
  useEffect(() => {
    if (isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await login(formData);

      if (result.success) {
        router.push('/');
      } else {
        setError(result.error || t('loginFailed'));
      }
    } catch (err) {
      setError(tc('unexpectedError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // エラーをクリア
    if (error) setError(null);
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setIsGoogleLoading(true);

    try {
      const result = await loginWithGoogle();
      if (!result.success) {
        setError(result.error || t('loginFailed'));
      }
      // 成功の場合は、AuthContextによってリダイレクトが自動的に処理される
    } catch (err) {
      setError(tc('unexpectedError'));
    } finally {
      setIsGoogleLoading(false);
    }
  };

  // ローディング中の表示
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-indigo-50 to-white dark:from-zinc-900 dark:to-zinc-800 px-4">
        <div className="w-full max-w-md space-y-8">
          {/* ヘッダースケルトン */}
          <div className="text-center">
            <div className="h-8 w-32 bg-zinc-200 dark:bg-zinc-700 rounded mx-auto mb-2 animate-pulse" />
            <div className="h-4 w-48 bg-zinc-200 dark:bg-zinc-700 rounded mx-auto animate-pulse" />
          </div>

          {/* フォームスケルトン */}
          <div className="bg-white dark:bg-zinc-800 rounded-xl shadow-2xl p-8 space-y-6">
            <div className="space-y-4">
              <div>
                <div className="h-4 w-16 bg-zinc-200 dark:bg-zinc-700 rounded mb-2 animate-pulse" />
                <div className="h-12 w-full bg-zinc-200 dark:bg-zinc-700 rounded-lg animate-pulse" />
              </div>
              <div>
                <div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-700 rounded mb-2 animate-pulse" />
                <div className="h-12 w-full bg-zinc-200 dark:bg-zinc-700 rounded-lg animate-pulse" />
              </div>
            </div>
            <div className="h-12 w-full bg-zinc-200 dark:bg-zinc-700 rounded-lg animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-indigo-50 to-white dark:from-zinc-900 dark:to-zinc-800 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {/* ヘッダー */}
        <div className="text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center">
            <LogIn className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h2 className="mt-6 text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            {t('loginTitle')}
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {t('noAccount')}{' '}
            <Link
              href="/auth/register"
              className="font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300"
            >
              {t('signUp')}
            </Link>
          </p>
        </div>

        {/* フォーム */}
        <div className="bg-white dark:bg-zinc-800 py-8 px-4 shadow-lg rounded-lg border border-zinc-200 dark:border-zinc-700">
          <form className="space-y-6" onSubmit={handleSubmit}>
            {/* エラー表示 */}
            {error && (
              <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4 border border-red-200 dark:border-red-800">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-red-400" />
                  <div className="ml-3">
                    <p className="text-sm font-medium text-red-800 dark:text-red-200">
                      {error}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ユーザー名 */}
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                {t('username')}
              </label>
              <div className="mt-1 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-zinc-400 dark:text-zinc-500" />
                </div>
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  value={formData.username}
                  onChange={handleInputChange}
                  className="appearance-none relative block w-full pl-10 px-3 py-2 border border-zinc-300 dark:border-zinc-600 placeholder-zinc-500 dark:placeholder-zinc-400 text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                  placeholder={t('usernamePlaceholder')}
                />
              </div>
            </div>

            {/* パスワード */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                {t('password')}
              </label>
              <div className="mt-1 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-zinc-400 dark:text-zinc-500" />
                </div>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={formData.password}
                  onChange={handleInputChange}
                  className="appearance-none relative block w-full pl-10 pr-10 px-3 py-2 border border-zinc-300 dark:border-zinc-600 placeholder-zinc-500 dark:placeholder-zinc-400 text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                  placeholder={t('passwordPlaceholder')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-400" />
                  ) : (
                    <Eye className="h-5 w-5 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-400" />
                  )}
                </button>
              </div>
            </div>

            {/* ログインボタン */}
            <div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    {t('loggingIn')}
                  </div>
                ) : (
                  <div className="flex items-center">
                    <LogIn className="h-4 w-4 mr-2" />
                    {t('login')}
                  </div>
                )}
              </button>
            </div>

            {/* 区切り線 */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-300 dark:border-zinc-600" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                  {tc('or')}
                </span>
              </div>
            </div>

            {/* Googleログインボタン */}
            <div>
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isGoogleLoading || isSubmitting}
                className="group relative w-full flex justify-center py-2 px-4 border border-zinc-300 dark:border-zinc-600 text-sm font-medium rounded-md text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isGoogleLoading ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-zinc-400 mr-2"></div>
                    {t('googleLoggingIn')}
                  </div>
                ) : (
                  <div className="flex items-center">
                    <GoogleIcon />
                    <span className="ml-2">{t('loginWithGoogle')}</span>
                  </div>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* フッター */}
        <div className="text-center">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            © 2026 Rapitas. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
