/**
 * 暗号化ユーティリティ
 * APIキーなどの機密情報を暗号化/復号化
 */

import crypto from "crypto";

// 暗号化キーは環境変数から取得、設定されていない場合はランダム生成（本番環境では必ず設定すること）
const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * 文字列を暗号化
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = Buffer.from(String(ENCRYPTION_KEY).slice(0, 64), "hex");

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // IV + AuthTag + 暗号文を結合
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * 暗号化された文字列を復号化
 */
export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted text format");
  }

  // parts[0..2] are guaranteed by the length check above, assert non-null for TS
  const iv = Buffer.from(parts[0]!, "hex");
  const authTag = Buffer.from(parts[1]!, "hex");
  const encrypted = parts[2]!;
  const key = Buffer.from(String(ENCRYPTION_KEY).slice(0, 64), "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  // Force returned chunks to string to avoid Buffer/string overload issues
  const first = decipher.update(encrypted, "hex", "utf8") as string;
  const last = decipher.final("utf8") as string;

  return first + last;
}

/**
 * APIキーをマスク（表示用）
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) {
    return "***";
  }
  return `${key.slice(0, 4)}${"*".repeat(key.length - 8)}${key.slice(-4)}`;
}

/**
 * 暗号化キーが設定されているか確認
 */
export function isEncryptionKeyConfigured(): boolean {
  return !!process.env.ENCRYPTION_KEY;
}
