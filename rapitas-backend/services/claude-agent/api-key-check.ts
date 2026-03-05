import { getApiKeyForProvider } from "../../utils/ai-client";

/**
 * APIキーが設定されているか確認（DB優先、環境変数フォールバック）
 * getApiKeyForProviderを使用して復号化・形式検証まで行う
 */
export async function isApiKeyConfiguredAsync(): Promise<boolean> {
  const key = await getApiKeyForProvider("claude");
  return !!key;
}

/**
 * APIキーが設定されているか確認（同期版 - 環境変数のみ）
 * 後方互換性のため保持
 */
export function isApiKeyConfigured(): boolean {
  return !!process.env.CLAUDE_API_KEY;
}
