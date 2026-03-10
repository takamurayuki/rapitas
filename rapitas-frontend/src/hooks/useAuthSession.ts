/**
 * 認証セッション管理フック
 * セッション状態の確認・トークンリフレッシュ・ログイン/ログアウト
 */

import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL, fetchWithRetry } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useAuthSession');

interface User {
  id: number;
  name: string;
  email: string;
}

interface AuthSessionState {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
}

export function useAuthSession() {
  const [state, setState] = useState<AuthSessionState>({
    isAuthenticated: false,
    user: null,
    isLoading: true,
  });

  const checkSession = useCallback(async () => {
    try {
      const res = await fetchWithRetry(
        `${API_BASE_URL}/auth/me`,
        {
          credentials: 'include',
        },
        3, // maxRetries
        300, // retryDelayMs
        10000, // timeoutMs
        { silent: true },
      );
      if (res.ok) {
        const data = await res.json();
        setState({ isAuthenticated: true, user: data.user, isLoading: false });
      } else {
        setState({ isAuthenticated: false, user: null, isLoading: false });
      }
    } catch (err) {
      logger.transientError('Session check failed:', err);
      setState({ isAuthenticated: false, user: null, isLoading: false });
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = useCallback(async (email: string, password: string) => {
    setState((prev) => ({ ...prev, isLoading: true }));
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error('Login failed');
    const data = await res.json();
    setState({ isAuthenticated: true, user: data.user, isLoading: false });
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
    setState({ isAuthenticated: false, user: null, isLoading: false });
  }, []);

  return {
    ...state,
    login,
    logout,
    refreshSession: checkSession,
  };
}
