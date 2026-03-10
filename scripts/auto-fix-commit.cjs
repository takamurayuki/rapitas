#!/usr/bin/env node
/**
 * 自動修正後にコミットを継続するpre-commitフック
 *
 * 処理フロー:
 * 1. lint-stagedを実行
 * 2. 失敗した場合、自動修正を試みる
 * 3. 修正後、変更を再ステージング
 * 4. 再度チェック
 * 5. それでも失敗する場合はエラー表示
 */

const { execSync } = require("child_process");
const fs = require("fs");

// 色付きログ
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function exec(command, options = {}) {
  try {
    return {
      success: true,
      output: execSync(command, {
        encoding: "utf8",
        stdio: "pipe",
        ...options,
      }),
    };
  } catch (error) {
    return {
      success: false,
      output: error.stdout || error.stderr || error.message,
      error,
    };
  }
}

function getStagedFiles() {
  const result = exec("git diff --cached --name-only --diff-filter=ACMR");
  if (!result.success) return [];
  return result.output.trim().split("\n").filter(Boolean);
}

function stageFiles(files) {
  if (files.length === 0) return true;
  
  // ファイルを1つずつステージング
  for (const file of files) {
    const result = exec(`git add "${file}"`);
    if (!result.success) {
      log(`  ⚠️  ${file} のステージングに失敗`, 'yellow');
    }
  }
  
  return true;
}

async function main() {
  log("\n🔍 Pre-commit チェックを開始...\n", "cyan");

  // 第1回目: lint-stagedを実行
  log("📋 Step 1: lint-staged を実行中...", "blue");
  const firstRun = exec("npx lint-staged");

  if (firstRun.success) {
    log("✅ すべてのチェックが通りました！\n", "green");
    process.exit(0);
  }

  // 失敗した場合
  log("⚠️  Lint/フォーマットエラーが検出されました\n", "yellow");

  // ステージされたファイルを記録
  const stagedFiles = getStagedFiles();
  if (stagedFiles.length === 0) {
    log("❌ ステージされたファイルがありません", "red");
    process.exit(1);
  }

  log(`📝 ${stagedFiles.length}個のファイルを自動修正します...\n`, "cyan");

  // フロントエンドファイル
  const frontendFiles = stagedFiles.filter(
    (f) =>
      f.startsWith("rapitas-frontend/src/") &&
      (f.endsWith(".ts") || f.endsWith(".tsx")),
  );

  // バックエンドファイル
  const backendFiles = stagedFiles.filter(
    (f) => f.startsWith("rapitas-backend/") && f.endsWith(".ts"),
  );

  let fixAttempted = false;

  // フロントエンドの自動修正
  if (frontendFiles.length > 0) {
    log('\n🎨 フロントエンドファイルを修正中...', 'magenta');

    // Prettier
    log("  ├─ Prettier実行...", "cyan");
    const prettierResult = exec(
      `cd rapitas-frontend && npx prettier --write "${frontendFiles
        .map((f) => f.replace("rapitas-frontend/", ""))
        .join('" "')}"`,
    );

    if (prettierResult.success) {
      log("  │  ✅ Prettier完了", "green");
    } else {
      log("  │  ⚠️  Prettier一部失敗", "yellow");
    }

    // ESLint
    log("  └─ ESLint --fix 実行...", "cyan");
    const eslintResult = exec(
      `cd rapitas-frontend && npx eslint --fix --config eslint.config.mjs "${frontendFiles
        .map((f) => f.replace("rapitas-frontend/", ""))
        .join('" "')}"`,
    );

    if (eslintResult.success) {
      log("     ✅ ESLint修正完了\n", "green");
    } else {
      log("     ⚠️  ESLint一部修正完了（警告が残っている可能性）\n", "yellow");
    }

    fixAttempted = true;
  }

  // バックエンドの自動修正
  if (backendFiles.length > 0) {
    log('\n⚙️  バックエンドファイルを修正中...', 'magenta');
    log("  └─ Prettier実行...", "cyan");

    const prettierResult = exec(
      `cd rapitas-backend && npx prettier --write "${backendFiles
        .map((f) => f.replace("rapitas-backend/", ""))
        .join('" "')}"`,
    );

    if (prettierResult.success) {
      log("     ✅ Prettier完了\n", "green");
    } else {
      log("     ⚠️  Prettier一部失敗\n", "yellow");
    }

    fixAttempted = true;
  }

  if (!fixAttempted) {
    log("❌ 修正対象のファイルがありません", "red");
    process.exit(1);
  }

  // 修正したファイルを再ステージング
  log("📦 修正したファイルを再ステージング中...", "cyan");
  const restageResult = stageFiles(stagedFiles);

  if (!restageResult) {
    log("❌ ファイルの再ステージングに失敗しました", "red");
    process.exit(1);
  }

  log("✅ 再ステージング完了\n", "green");

  // 第2回目: lint-stagedを再実行
  log("🔄 Step 2: 修正後の検証を実行中...", "blue");
  const secondRun = exec("npx lint-staged");

  if (secondRun.success) {
    log("✅ 自動修正が成功しました！", "green");
    log("✨ コミットを継続します\n", "cyan");
    process.exit(0);
  }

  // それでも失敗する場合
  log("", "reset");
  log("═══════════════════════════════════════════", "red");
  log("❌ 自動修正後もエラーが残っています", "red");
  log("═══════════════════════════════════════════", "red");
  log("", "reset");

  log("🔍 詳細なエラーを確認するには:", "yellow");
  log("   npm run check:commit\n", "cyan");

  log("💡 手動で修正するか、以下のコマンドでコミットできます:", "yellow");
  log("   git commit --no-verify\n", "cyan");

  // エラー内容の一部を表示
  if (secondRun.output) {
    log("📋 エラー内容（抜粋）:", "yellow");
    const lines = secondRun.output.split("\n").slice(0, 20);
    lines.forEach((line) => {
      if (line.trim()) {
        console.log(`   ${line}`);
      }
    });
  }

  process.exit(1);
}

main().catch((error) => {
  log(`\n❌ 予期しないエラーが発生しました: ${error.message}`, "red");
  console.error(error);
  process.exit(1);
});
