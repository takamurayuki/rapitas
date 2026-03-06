/**
 * AIプロバイダーAPIキー管理・認証情報
 */
import { prisma } from "../../config/database";
import { decrypt } from "../encryption";
import { createLogger } from "../../config/logger";
import {
  type AIProvider,
  PROVIDER_KEY_COLUMNS,
  PROVIDER_MODEL_COLUMNS,
  DEFAULT_MODELS,
} from "./types";

const log = createLogger("ai-client:credentials");

/**
 * APIキーの基本的な形式を検証
 */
export function isValidApiKeyFormat(apiKey: string, provider: AIProvider): boolean {
  const trimmed = apiKey.trim();
  if (!trimmed || trimmed.length < 10) return false;

  switch (provider) {
    case "claude":
      return trimmed.startsWith("sk-ant-api");
    case "chatgpt":
      return trimmed.startsWith("sk-") && !trimmed.startsWith("sk-ant-api");
    case "gemini":
      return trimmed.startsWith("AIza");
    default:
      return true;
  }
}

/**
 * 指定プロバイダーのAPIキーをDBから取得・復号化
 * DBに保存されたキーを優先し、存在しない場合のみ環境変数にフォールバック
 */
export async function getApiKeyForProvider(provider: AIProvider): Promise<string | null> {
  // まずDBから取得を試みる（ユーザーが設定画面で登録したキーを優先）
  const settings = await prisma.userSettings.findFirst();
  if (settings) {
    const column = PROVIDER_KEY_COLUMNS[provider];
    const encrypted = settings[column];
    if (encrypted) {
      try {
        const decrypted = decrypt(encrypted);
        if (decrypted && isValidApiKeyFormat(decrypted, provider)) {
          return decrypted;
        }
        // 復号できたが形式が不正な場合はログ出力して環境変数にフォールバック
        log.warn(`DB stored ${provider} API key has invalid format, falling back to env var`);
      } catch (error) {
        log.warn({ err: error instanceof Error ? error : undefined, detail: error instanceof Error ? undefined : error }, `Failed to decrypt ${provider} API key from DB`);
      }
    }
  }

  // DBにキーがない場合、Claude のみ環境変数にフォールバック
  if (provider === "claude" && process.env.CLAUDE_API_KEY) {
    const envKey = process.env.CLAUDE_API_KEY;
    if (isValidApiKeyFormat(envKey, provider)) {
      return envKey;
    }
    log.warn("CLAUDE_API_KEY env var has invalid format");
  }

  return null;
}

/**
 * 指定プロバイダーのデフォルトモデルをDBから取得
 */
export async function getDefaultModel(provider: AIProvider): Promise<string> {
  const settings = await prisma.userSettings.findFirst();
  if (settings) {
    const column = PROVIDER_MODEL_COLUMNS[provider];
    const model = settings[column];
    if (model) return model;
  }
  return DEFAULT_MODELS[provider];
}

/**
 * ユーザーのデフォルトAIプロバイダーを取得
 */
export async function getDefaultProvider(): Promise<AIProvider> {
  const settings = await prisma.userSettings.findFirst();
  if (settings?.defaultAiProvider) {
    return settings.defaultAiProvider as AIProvider;
  }
  return "claude";
}

/**
 * デフォルトプロバイダーのAPIキーが設定されているか確認
 */
export async function isAnyApiKeyConfigured(): Promise<boolean> {
  const provider = await getDefaultProvider();
  const key = await getApiKeyForProvider(provider);
  return !!key;
}

/**
 * どのプロバイダーが設定済みか返す
 */
export async function getConfiguredProviders(): Promise<AIProvider[]> {
  const providers: AIProvider[] = ["claude", "chatgpt", "gemini"];
  const configured: AIProvider[] = [];
  for (const p of providers) {
    const key = await getApiKeyForProvider(p);
    if (key) configured.push(p);
  }
  return configured;
}
