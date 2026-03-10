'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import { API_BASE_URL, fetchWithRetry } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('AuthContext');

// 型定義
export interface User {
  id: number;
  username: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: string;
  lastLoginAt: string | null;
  googleId?: string | null; // Google IDを追加
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  sessionToken: string | null;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface RegisterCredentials {
  username: string;
  email: string;
  password: string;
}

export interface AuthContextType extends AuthState {
  login: (
    credentials: LoginCredentials,
  ) => Promise<{ success: boolean; error?: string }>;
  register: (
    credentials: RegisterCredentials,
  ) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refreshSession: () => Promise<void>;
}

// コンテキスト作成
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// AuthProvider コンポーネント
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    sessionToken: null,
  });

  // Cookie-based認証では不要
  // const getStoredToken = () => ...
  // const setStoredToken = (token: string | null) => ...

  // セッション検証
  const validateSession = async (): Promise<User | null> => {
    try {
      const response = await fetchWithRetry(
        `${API_BASE_URL}/auth/me`,
        {
          method: 'GET',
          credentials: 'include', // Cookieを含める
          headers: {
            'Content-Type': 'application/json',
          },
        },
        3, // maxRetries
        300, // retryDelayMs
        10000, // timeoutMs
        { silent: true }, // 起動時の一時的エラーはwarnレベルで出力
      );

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          return data.user;
        }
      }
      return null;
    } catch (error) {
      logger.transientError('セッション検証エラー:', error);
      return null;
    }
  };

  // セッション更新
  const refreshSession = async () => {
    const user = await validateSession();
    if (user) {
      setState({
        user,
        isAuthenticated: true,
        isLoading: false,
        sessionToken: null, // Cookie-based認証なのでnull
      });
    } else {
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        sessionToken: null,
      });
    }
  };

  // ログイン
  const login = async (
    credentials: LoginCredentials,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));

      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        credentials: 'include', // Cookieを含める
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        const { user } = data;

        setState({
          user,
          isAuthenticated: true,
          isLoading: false,
          sessionToken: null, // Cookie-based認証なのでnull
        });

        return { success: true };
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
        return {
          success: false,
          error: data.message || 'ログインに失敗しました',
        };
      }
    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));
      logger.error('ログインエラー:', error);
      return { success: false, error: 'ネットワークエラーが発生しました' };
    }
  };

  // ユーザー登録
  const register = async (
    credentials: RegisterCredentials,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));

      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        credentials: 'include', // Cookieを含める
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        const { user } = data;

        setState({
          user,
          isAuthenticated: true,
          isLoading: false,
          sessionToken: null, // Cookie-based認証なのでnull
        });

        return { success: true };
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
        return { success: false, error: data.message || '登録に失敗しました' };
      }
    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));
      logger.error('登録エラー:', error);
      return { success: false, error: 'ネットワークエラーが発生しました' };
    }
  };

  // ログアウト
  const logout = async () => {
    try {
      // サーバーにログアウト通知
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include', // Cookieを含める
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      logger.error('ログアウト通知エラー:', error);
    } finally {
      // ローカル状態をクリア
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        sessionToken: null,
      });
    }
  };

  // Googleログイン
  const loginWithGoogle = async (): Promise<{
    success: boolean;
    error?: string;
  }> => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));

      // Google OAuth URLを取得
      const response = await fetch(`${API_BASE_URL}/auth/google/url`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok && data.success && data.url) {
        // Google認証ページにリダイレクト
        window.location.href = data.url;
        return { success: true };
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
        return {
          success: false,
          error: data.message || 'Google認証URLの取得に失敗しました',
        };
      }
    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));
      logger.error('Googleログインエラー:', error);
      return { success: false, error: 'ネットワークエラーが発生しました' };
    }
  };

  // 初回セッション復元
  useEffect(() => {
    refreshSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const contextValue: AuthContextType = {
    ...state,
    login,
    register,
    loginWithGoogle,
    logout,
    refreshSession,
  };

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}

// useAuth フック
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// 認証が必要なコンポーネント用のHOC
export function requireAuth<P extends object>(
  WrappedComponent: React.ComponentType<P>,
) {
  return function AuthenticatedComponent(props: P) {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="flex flex-col items-center space-y-4">
            {/* Simple spinner for authentication check */}
            <div className="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-600 dark:border-t-zinc-300 rounded-full animate-spin" />
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              認証を確認中...
            </div>
          </div>
        </div>
      );
    }

    if (!isAuthenticated) {
      // 未認証の場合は認証ページにリダイレクト
      if (typeof window !== 'undefined') {
        window.location.href = '/auth/login';
      }
      return null;
    }

    return <WrappedComponent {...props} />;
  };
}
