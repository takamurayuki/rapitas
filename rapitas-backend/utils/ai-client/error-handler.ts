/**
 * AI Provider Error Handling
 */
import { type AIProvider, PROVIDER_NAMES } from './types';

/**
 * Classify an error by its message and convert it to a user-facing message.
 */
export function formatApiError(error: unknown, provider: AIProvider): string {
  const message = error instanceof Error ? error.message : String(error);

  const isAuthError =
    message.includes('authentication_error') ||
    message.includes('invalid x-api-key') ||
    message.includes('invalid api key') ||
    message.includes('Incorrect API key') ||
    message.includes('401') ||
    message.includes('API key not valid');

  if (isAuthError) {
    return `${PROVIDER_NAMES[provider]} APIキーが無効です。設定画面で正しいAPIキーを再設定してください。`;
  }

  const isOverloaded =
    message.includes('529') || message.includes('overloaded') || message.includes('Overloaded');

  if (isOverloaded) {
    return `${PROVIDER_NAMES[provider]} APIが現在混雑しています。しばらく待ってから再度お試しください。`;
  }

  const isQuotaError =
    message.includes('429') ||
    message.includes('Too Many Requests') ||
    message.includes('quota') ||
    message.includes('rate limit') ||
    message.includes('RESOURCE_EXHAUSTED');

  if (isQuotaError) {
    const isFreeeTier = message.includes('free_tier') || message.includes('FreeTier');
    if (isFreeeTier) {
      return `${PROVIDER_NAMES[provider]} APIの無料枠のクォータを超過しました。Google Cloud Consoleで課金（Billing）を有効にするか、有料プランにアップグレードしてください。詳細: https://ai.google.dev/gemini-api/docs/rate-limits`;
    }
    return `${PROVIDER_NAMES[provider]} APIのレート制限に達しました。しばらく待ってから再度お試しください。`;
  }

  const isModelNotFound =
    message.includes('404') || message.includes('not found') || message.includes('is not found');

  if (isModelNotFound) {
    return `${PROVIDER_NAMES[provider]} の指定されたモデルが見つかりません。設定画面でモデルを変更してください。`;
  }

  return error instanceof Error ? error.message : 'AIとの通信中にエラーが発生しました';
}

/**
 * Evaluate an API error and re-throw with a user-friendly message.
 */
export function handleApiError(error: unknown, provider: AIProvider): never {
  const userMessage = formatApiError(error, provider);
  const originalMessage = error instanceof Error ? error.message : String(error);

  // If the message was translated to a user-facing version, throw a new Error
  if (userMessage !== originalMessage) {
    throw new Error(userMessage);
  }

  throw error;
}
