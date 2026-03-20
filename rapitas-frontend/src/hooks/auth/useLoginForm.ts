/**
 * ログインフォーム管理用のカスタムフック
 * フォーム状態、バリデーション、送信処理を提供
 */

import { useState, useCallback } from 'react';
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

function validate(username: string, password: string): LoginErrors {
  const errors: LoginErrors = {};
  if (!username.trim()) {
    errors.username = 'ユーザー名を入力してください';
  }
  if (!password) {
    errors.password = 'パスワードを入力してください';
  } else if (password.length < 6) {
    errors.password = 'パスワードは6文字以上で入力してください';
  }
  return errors;
}

export function useLoginForm(): UseLoginFormReturn {
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

      const validationErrors = validate(username, password);
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
          throw new Error(data.message || 'ログインに失敗しました');
        }

        // Successful login - redirect handled by caller or auth context
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'ログイン中にエラーが発生しました';
        logger.error('Login failed:', err);
        setErrors({ form: message });
      } finally {
        setIsSubmitting(false);
      }
    },
    [username, password],
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
