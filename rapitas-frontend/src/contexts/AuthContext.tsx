'use client';
// AuthContext

import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { API_BASE_URL, fetchWithRetry } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('AuthContext');

export interface User {
  id: number;
  username: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: string;
  lastLoginAt: string | null;
  googleId?: string | null;
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
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;
  register: (credentials: RegisterCredentials) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    sessionToken: null,
  });

  // NOTE: Token storage helpers removed — authentication is now cookie-based, so no client-side token management is needed.

  const validateSession = async (): Promise<User | null> => {
    try {
      const response = await fetchWithRetry(
        `${API_BASE_URL}/auth/me`,
        {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
        },
        3, // maxRetries
        300, // retryDelayMs
        10000, // timeoutMs
        { silent: true }, // NOTE: Transient errors at startup are expected while backend initializes; silent mode avoids noisy error logs.
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

  const refreshSession = async () => {
    const user = await validateSession();
    if (user) {
      setState({
        user,
        isAuthenticated: true,
        isLoading: false,
        sessionToken: null,
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

  const login = async (
    credentials: LoginCredentials,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));

      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        credentials: 'include',
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
          sessionToken: null,
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

  const register = async (
    credentials: RegisterCredentials,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));

      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        credentials: 'include',
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
          sessionToken: null,
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

  const logout = async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      logger.error('ログアウト通知エラー:', error);
    } finally {
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        sessionToken: null,
      });
    }
  };

  const loginWithGoogle = async (): Promise<{
    success: boolean;
    error?: string;
  }> => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));

      const response = await fetch(`${API_BASE_URL}/auth/google/url`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok && data.success && data.url) {
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

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function requireAuth<P extends object>(WrappedComponent: React.ComponentType<P>) {
  return function AuthenticatedComponent(props: P) {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="flex flex-col items-center space-y-4">
            <div className="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-600 dark:border-t-zinc-300 rounded-full animate-spin" />
            <div className="text-sm text-zinc-500 dark:text-zinc-400">認証を確認中...</div>
          </div>
        </div>
      );
    }

    if (!isAuthenticated) {
      if (typeof window !== 'undefined') {
        window.location.href = '/auth/login';
      }
      return null;
    }

    return <WrappedComponent {...props} />;
  };
}
