/**
 * ログインフォーム管理用のカスタムフック
 * フォーム状態、バリデーション、送信処理を提供
 */

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useLoginForm');

interface LoginErrors {
  username?: string;
  password?: string;
  form?: string;
}

interface UseLoginFormReturn {
  username: string;
  password: string;
  setUsername: (value: string) => void;
  setPassword: (value: string) => void;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  errors: LoginErrors;
  isSubmitting: boolean;
  clearErrors: () => void;
}

function validate(username: string, password: string, t: (key: string) => string): LoginErrors {
  const errors: LoginErrors = {};
  if (!username.trim()) {
    errors.username = t('loginForm.usernameRequired');
  }
  if (!password) {
    errors.password = t('loginForm.passwordRequired');
  } else if (password.length < 6) {
    errors.password = t('loginForm.passwordTooShort');
  }
  return errors;
}

export function useLoginForm(): UseLoginFormReturn {
  const t = useTranslations('common');
  const tAuth = useTranslations('auth');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<LoginErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const clearErrors = useCallback(() => {
    setErrors({});
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const validationErrors = validate(username, password, t);
      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        return;
      }

      setIsSubmitting(true);
      setErrors({});

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || tAuth('loginFailed'));
        }

        // Successful login - redirect handled by caller or auth context
      } catch (err) {
        const message = err instanceof Error ? err.message : t('loginForm.loginError');
        logger.error('Login failed:', err);
        setErrors({ form: message });
      } finally {
        setIsSubmitting(false);
      }
    },
    [username, password, t, tAuth],
  );

  return {
    username,
    password,
    setUsername,
    setPassword,
    handleSubmit,
    errors,
    isSubmitting,
    clearErrors,
  };
}
