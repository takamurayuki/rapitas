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
  },
};
