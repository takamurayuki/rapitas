/**
 * API Base URL
 * 環境変数から取得し、設定されていない場合はデフォルト値を使用
 */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

/**
 * APIエンドポイントを構築するヘルパー関数
 */
export function buildApiUrl(path: string): string {
  // パスが / で始まっていない場合は追加
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}
