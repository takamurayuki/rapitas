/**
 * Branch Name Generator テスト
 * ブランチ名サニタイズ・バリデーション・フォールバック生成のテスト
 */
import { describe, test, expect } from "bun:test";
import {
  sanitizeBranchName,
  isValidBranchName,
  generateFallbackBranchName,
} from "../../utils/branch-name-generator";

describe("sanitizeBranchName", () => {
  test("正常なブランチ名をそのまま返すこと", () => {
    expect(sanitizeBranchName("feature/add-auth")).toBe("feature/add-auth");
  });

  test("大文字を小文字に変換すること", () => {
    expect(sanitizeBranchName("Feature/Add-Auth")).toBe("feature/add-auth");
  });

  test("特殊文字をハイフンに変換すること", () => {
    expect(sanitizeBranchName("feature/add auth!@#")).toBe("feature/add-auth");
  });

  test("連続するハイフンを1つにまとめること", () => {
    expect(sanitizeBranchName("feature/add---auth")).toBe("feature/add-auth");
  });

  test("先頭・末尾のハイフンを除去すること", () => {
    expect(sanitizeBranchName("-feature/test-")).toBe("feature/test");
  });

  test("50文字を超える場合に切り詰めること", () => {
    const longName = "feature/" + "a".repeat(100);
    const result = sanitizeBranchName(longName);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  test("空文字列を処理できること", () => {
    const result = sanitizeBranchName("");
    expect(typeof result).toBe("string");
  });
});

describe("isValidBranchName", () => {
  test("有効なfeature/ブランチ名を受け入れること", () => {
    expect(isValidBranchName("feature/add-auth")).toBe(true);
  });

  test("有効なbugfix/ブランチ名を受け入れること", () => {
    expect(isValidBranchName("bugfix/fix-login")).toBe(true);
  });

  test("有効なchore/ブランチ名を受け入れること", () => {
    expect(isValidBranchName("chore/update-deps")).toBe(true);
  });

  test("空文字列を拒否すること", () => {
    expect(isValidBranchName("")).toBe(false);
  });

  test("50文字を超える名前を拒否すること", () => {
    const longName = "feature/" + "a".repeat(50);
    expect(isValidBranchName(longName)).toBe(false);
  });

  test("無効なプレフィックスを拒否すること", () => {
    expect(isValidBranchName("invalid/branch")).toBe(false);
    expect(isValidBranchName("main")).toBe(false);
    expect(isValidBranchName("release/v1")).toBe(false);
  });

  test("スペースを含む名前を拒否すること", () => {
    expect(isValidBranchName("feature/add auth")).toBe(false);
  });

  test("特殊文字を含む名前を拒否すること", () => {
    expect(isValidBranchName("feature/add~auth")).toBe(false);
    expect(isValidBranchName("feature/add^auth")).toBe(false);
    expect(isValidBranchName("feature/add:auth")).toBe(false);
    expect(isValidBranchName("feature/add?auth")).toBe(false);
    expect(isValidBranchName("feature/add*auth")).toBe(false);
  });

  test("連続するドットを拒否すること", () => {
    expect(isValidBranchName("feature/add..auth")).toBe(false);
  });

  test("先頭がドットの名前を拒否すること", () => {
    expect(isValidBranchName(".feature/test")).toBe(false);
  });

  test("末尾がハイフンの名前を拒否すること", () => {
    expect(isValidBranchName("feature/test-")).toBe(false);
  });
});

describe("generateFallbackBranchName", () => {
  test("英語タイトルからfeature/プレフィックスのブランチ名を生成すること", () => {
    const result = generateFallbackBranchName("Add user authentication");
    expect(result.startsWith("feature/")).toBe(true);
    expect(result).toContain("add");
    expect(result).toContain("user");
    expect(result).toContain("authentication");
  });

  test("バグ関連キーワードでbugfix/プレフィックスを使用すること", () => {
    const result = generateFallbackBranchName("Fix login error");
    expect(result.startsWith("bugfix/")).toBe(true);
  });

  test("日本語のバグキーワードでbugfix/プレフィックスを使用すること", () => {
    const result = generateFallbackBranchName("ログインバグを修正");
    expect(result.startsWith("bugfix/")).toBe(true);
  });

  test("chore関連キーワードでchore/プレフィックスを使用すること", () => {
    const result = generateFallbackBranchName("Refactor database layer");
    expect(result.startsWith("chore/")).toBe(true);
  });

  test("日本語のchoreキーワードでchore/プレフィックスを使用すること", () => {
    const result = generateFallbackBranchName("依存関係を更新する");
    expect(result.startsWith("chore/")).toBe(true);
  });

  test("生成されたブランチ名がバリデーションを通ること", () => {
    const result = generateFallbackBranchName("Add new feature");
    expect(isValidBranchName(result)).toBe(true);
  });

  test("空のタイトルでもデフォルト名を生成すること", () => {
    const result = generateFallbackBranchName("");
    expect(result.length).toBeGreaterThan(0);
  });
});
