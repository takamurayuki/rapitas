'use client';
// AuthContext

import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL, fetchWithRetry } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('AuthContext');

/**
 * localStorage flag remembering that the user established a session, so a guest
 * (never-signed-in) load skips the `/auth/me` probe entirely instead of 401-ing
 * and logging a noisy "セッション検証エラー" on every load. Set on
 * login/register/Google redirect; cleared on logout or a stale-session 401.
 */
const SESSION_HINT_KEY = 'rapitas.hasSession';

/** True when a prior session was established (and not yet logged out). */
function hasSessionHint(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist or clear the "has session" hint. No-op when storage is unavailable. */
function setSessionHint(active: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (active) window.localStorage.setItem(SESSION_HINT_KEY, '1');
    else window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // localStorage unavailable (private mode / SSR) — non-fatal.
  }
}

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
  const tAuth = useTranslations('auth');
  const t = useTranslations('common');
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
      // No active session (guest / expired) is an expected state in this
      // guest-first app — keep it at debug so it never surfaces as an error.
      logger.debug('セッション検証をスキップ（未ログイン扱い）:', error);
      return null;
    }
  };

  const refreshSession = async () => {
    // Guest mode (never signed in): skip the /auth/me probe entirely. The
    // backend serves data without a session, so validating one we don't have
    // would only 401 and log noise on every load.
    if (!hasSessionHint()) {
      setState({ user: null, isAuthenticated: false, isLoading: false, sessionToken: null });
      return;
    }
    const user = await validateSession();
    if (user) {
      setState({
        user,
        isAuthenticated: true,
        isLoading: false,
        sessionToken: null,
      });
    } else {
      // Hint was stale (session expired/invalidated) — drop it so subsequent
      // loads stay in silent guest mode.
      setSessionHint(false);
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

        setSessionHint(true);
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
          error: data.message || tAuth('loginFailed'),
        };
      }
    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));
      logger.error('ログインエラー:', error);
      return { success: false, error: t('authContext.networkError') };
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

        setSessionHint(true);
        setState({
          user,
          isAuthenticated: true,
          isLoading: false,
          sessionToken: null,
        });

        return { success: true };
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
        return { success: false, error: data.message || tAuth('registrationFailed') };
      }
    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));
      logger.error('登録エラー:', error);
      return { success: false, error: t('authContext.networkError') };
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
      setSessionHint(false);
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
        // Set the hint before leaving for Google so that on return refreshSession
        // validates the new cookie session (a stale hint self-clears on 401).
        setSessionHint(true);
        window.location.href = data.url;
        return { success: true };
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
        return {
          success: false,
          error: data.message || t('authContext.googleAuthUrlFailed'),
        };
      }
    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));
      logger.error('Googleログインエラー:', error);
      return { success: false, error: t('authContext.networkError') };
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

/**
 * Page wrapper that USED to force a login redirect. rapitas is a local,
 * single-user desktop app whose backend serves data without a session, so a
 * mandatory login was friction with no security benefit and caused users to
 * bounce off the login wall. It now renders for everyone (guest by default);
 * signing in stays optional (header "ログイン" → /auth/login) for when cloud
 * sync / sharing lands. Kept as a wrapper so the gate can be reinstated in one
 * place if that day comes.
 */
export function requireAuth<P extends object>(WrappedComponent: React.ComponentType<P>) {
  return function AuthenticatedComponent(props: P) {
    return <WrappedComponent {...props} />;
  };
}
