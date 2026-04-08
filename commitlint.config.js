module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',     // 新機能
        'fix',      // バグ修正
        'docs',     // ドキュメント
        'style',    // フォーマット
        'refactor', // リファクタリング
        'test',     // テスト
        'chore',    // その他
        'perf',     // パフォーマンス
        'ci',       // CI/CD
        'revert',   // リバート
      ],
    ],
    'subject-max-length': [1, 'always', 72],
    'body-max-line-length': [0, 'always', Infinity],
    'scope-enum': [
      1, // warning level (CLAUDE.md uses scopes loosely; raise to 2 once stable)
      'always',
      [
        // Apps
        'frontend',
        'backend',
        'desktop',
        'tauri',
        // Cross-cutting
        'repo',
        'ci',
        'docs',
        'deps',
        'config',
        'scripts',
        // Backend domains
        'tasks',
        'agents',
        'workflow',
        'auth',
        'prisma',
        'db',
        'api',
        'ai',
        'memory',
        'github',
        'schedule',
        // Frontend domains
        'ui',
        'editor',
        'voice',
        'kanban',
        'calendar',
        'pomodoro',
        'i18n',
        'theme',
      ],
    ],
    'scope-case': [2, 'always', 'kebab-case'],
  },
};
