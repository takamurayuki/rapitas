#!/usr/bin/env node
/**
 * コミット前チェックスクリプト
 * フォーマットとLintのエラーを詳細に表示
 *
 * 注意: 大量のファイルがステージされている場合はglob patternを使用
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 色付きログ用
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

// ファイル数がこれ以上の場合はglobパターンを使用
const MAX_FILES_FOR_INDIVIDUAL_CHECK = 50;

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function exec(command, options = {}) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 10 * 1024 * 1024, // 10MBバッファ
      ...options,
    });
  } catch (error) {
    return {
      error: true,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      exitCode: error.status,
    };
  }
}

async function checkStagedFiles() {
  log('\n🔍 ステージされたファイルをチェック中...\n', 'cyan');

  // ステージされたファイルを取得
  const stagedFiles = exec('git diff --cached --name-only --diff-filter=ACMR');

  if (stagedFiles.error) {
    log('❌ ステージされたファイルの取得に失敗しました', 'red');
    return false;
  }

  const files = stagedFiles.trim().split('\n').filter(Boolean);

  if (files.length === 0) {
    log('⚠️  ステージされたファイルがありません', 'yellow');
    return true;
  }

  log(`📝 ${files.length}個のファイルがステージされています\n`, 'blue');

  let hasErrors = false;

  // フロントエンドファイルのチェック
  const frontendFiles = files.filter(
    (f) => f.startsWith('rapitas-frontend/src/') && (f.endsWith('.ts') || f.endsWith('.tsx')),
  );

  if (frontendFiles.length > 0) {
    log('🎨 フロントエンドファイルをチェック中...', 'magenta');
    log(`   ${frontendFiles.length}個のファイル\n`, 'blue');

    // ファイル数が多い場合はglobパターンを使用
    const useGlob = frontendFiles.length > MAX_FILES_FOR_INDIVIDUAL_CHECK;
    const prettierTarget = useGlob
      ? '"src/**/*.{ts,tsx}"'
      : `"${frontendFiles.map((f) => f.replace('rapitas-frontend/', '')).join('" "')}"`;
    const eslintTarget = useGlob
      ? '"src/**/*.{ts,tsx}"'
      : `"${frontendFiles.map((f) => f.replace('rapitas-frontend/', '')).join('" "')}"`;

    // Prettier チェック
    log('  ├─ Prettierチェック...', 'cyan');
    const prettierCheck = exec(`cd rapitas-frontend && npx prettier --check ${prettierTarget}`, {
      cwd: process.cwd(),
    });

    if (prettierCheck.error) {
      log('  │  ❌ Prettierエラーが見つかりました:', 'red');

      const output = prettierCheck.stderr || prettierCheck.stdout || '';
      const lines = output.split('\n');

      // ファイル名だけを抽出して表示
      const errorFiles = lines.filter((line) => {
        const trimmed = line.trim();
        return (
          trimmed &&
          !trimmed.includes('Checking formatting') &&
          !trimmed.includes('Code style issues') &&
          !trimmed.includes('All matched files')
        );
      });

      if (errorFiles.length > 0 && errorFiles.length <= 10) {
        errorFiles.forEach((line) => {
          log(`  │     📄 ${line.trim()}`, 'yellow');
        });
      } else if (errorFiles.length > 10) {
        log(`  │     ${errorFiles.length}個のファイルにフォーマットエラー`, 'yellow');
      }

      log(
        '  │  💡 修正方法: cd rapitas-frontend && npx prettier --write "src/**/*.{ts,tsx}"',
        'yellow',
      );
      hasErrors = true;
    } else {
      log('  │  ✅ Prettier OK', 'green');
    }

    // ESLint チェック (警告は許可、エラーのみ失敗)
    log('  └─ ESLintチェック...', 'cyan');
    const eslintCheck = exec(
      `cd rapitas-frontend && npx eslint --config eslint.config.mjs --max-warnings=9999 ${eslintTarget}`,
      { cwd: process.cwd() },
    );

    if (eslintCheck.error) {
      // ESLintがエラー終了した場合のみ失敗
      const output = eslintCheck.stdout || eslintCheck.stderr || '';
      const hasActualErrors = output.includes(' error ') || output.includes('\terror\t');

      if (hasActualErrors) {
        log('     ❌ ESLintエラーが見つかりました:', 'red');
        log('', 'reset');

        const lines = output.split('\n');
        let displayedErrors = 0;

        lines.forEach((line) => {
          if (displayedErrors >= 15) return; // 最大15行まで表示

          if ((line.includes('.ts') || line.includes('.tsx')) && !line.includes('eslint')) {
            if (line.trim()) {
              log(`     📄 ${line.trim()}`, 'yellow');
              displayedErrors++;
            }
          } else if (line.match(/^\s+\d+:\d+\s+error/)) {
            const match = line.match(/(\d+):(\d+)\s+error\s+(.+)/);
            if (match) {
              const [, lineNum, col, message] = match;
              log(`        ❌ Line ${lineNum}:${col} - ${message}`, 'red');
              displayedErrors++;
            }
          }
        });

        log('', 'reset');
        log('     💡 修正方法: cd rapitas-frontend && npx eslint --fix <ファイル名>', 'yellow');
        hasErrors = true;
      } else {
        // 警告のみの場合はOK
        log('     ✅ ESLint OK (警告のみ)', 'green');
      }
    } else {
      log('     ✅ ESLint OK', 'green');
    }

    log('', 'reset');
  }

  // バックエンドファイルのチェック
  const backendFiles = files.filter((f) => f.startsWith('rapitas-backend/') && f.endsWith('.ts'));

  if (backendFiles.length > 0) {
    log('⚙️  バックエンドファイルをチェック中...', 'magenta');
    log(`   ${backendFiles.length}個のファイル\n`, 'blue');

    // ファイル数が多い場合はglobパターンを使用
    const useGlob = backendFiles.length > MAX_FILES_FOR_INDIVIDUAL_CHECK;
    const prettierTarget = useGlob
      ? '"**/*.ts"'
      : `"${backendFiles.map((f) => f.replace('rapitas-backend/', '')).join('" "')}"`;

    // Prettier チェック
    log('  └─ Prettierチェック...', 'cyan');
    const prettierCheck = exec(`cd rapitas-backend && npx prettier --check ${prettierTarget}`, {
      cwd: process.cwd(),
    });

    if (prettierCheck.error) {
      log('     ❌ Prettierエラーが見つかりました:', 'red');

      const output = prettierCheck.stderr || prettierCheck.stdout || '';
      const lines = output.split('\n');

      const errorFiles = lines.filter((line) => {
        const trimmed = line.trim();
        return (
          trimmed &&
          !trimmed.includes('Checking formatting') &&
          !trimmed.includes('Code style issues') &&
          !trimmed.includes('All matched files')
        );
      });

      if (errorFiles.length > 0 && errorFiles.length <= 10) {
        errorFiles.forEach((line) => {
          log(`        📄 ${line.trim()}`, 'yellow');
        });
      } else if (errorFiles.length > 10) {
        log(`        ${errorFiles.length}個のファイルにフォーマットエラー`, 'yellow');
      }

      log('     💡 修正方法: cd rapitas-backend && npx prettier --write "**/*.ts"', 'yellow');
      hasErrors = true;
    } else {
      log('     ✅ Prettier OK', 'green');
    }

    log('', 'reset');
  }

  // 結果サマリー
  log('═══════════════════════════════════════════', 'blue');
  if (hasErrors) {
    log('❌ チェック失敗: 上記のエラーを修正してください', 'red');
    log('\n💡 クイック修正コマンド:', 'yellow');
    if (frontendFiles.length > 0) {
      log(
        '   cd rapitas-frontend && npx prettier --write "src/**/*.{ts,tsx}" && npx eslint --fix "src/**/*.{ts,tsx}"',
        'cyan',
      );
    }
    if (backendFiles.length > 0) {
      log('   cd rapitas-backend && npx prettier --write "**/*.ts"', 'cyan');
    }
    log('\n⚠️  または警告を無視してコミット: git commit --no-verify\n', 'yellow');
    return false;
  } else {
    log('✅ すべてのチェックが完了しました！', 'green');
    return true;
  }
}

// メイン処理
(async () => {
  try {
    const success = await checkStagedFiles();
    process.exit(success ? 0 : 1);
  } catch (error) {
    log(`\n❌ エラーが発生しました: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
})();
