import {
  transformLogToUserFriendly,
  transformLogsToSimple,
  detectCurrentPhase,
} from '../log-message-transformer';

describe('log-message-transformer', () => {
  describe('transformLogToUserFriendly', () => {
    test('フェーズ遷移ログを正しく変換する', () => {
      const researchLog = '[research] 依存関係を分析';
      const result = transformLogToUserFriendly(researchLog);

      expect(result.category).toBe('progress');
      expect(result.message).toBe('📊 調査フェーズを開始しました');
      expect(result.phase).toBe('research');
      expect(result.iconName).toBe('Search');
    });

    test('ファイル操作ログを正しく変換する', () => {
      const editLog = 'file_edit src/components/Button.tsx';
      const result = transformLogToUserFriendly(editLog);

      expect(result.category).toBe('info');
      expect(result.message).toBe('📝 Button.tsx を編集しました');
      expect(result.detail).toBe('src/components/Button.tsx');
      expect(result.iconName).toBe('FileEdit');
    });

    test('ファイル作成ログを正しく変換する', () => {
      const createLog = 'file_create new-component.tsx';
      const result = transformLogToUserFriendly(createLog);

      expect(result.category).toBe('success');
      expect(result.message).toBe('✨ 新しいファイル new-component.tsx を作成しました');
      expect(result.iconName).toBe('FileEdit');
    });

    test('エラーログを正しく変換する', () => {
      const errorLog = 'Error: Failed to compile TypeScript';
      const result = transformLogToUserFriendly(errorLog);

      expect(result.category).toBe('error');
      expect(result.message).toBe('❌ エラーが発生しました');
      expect(result.detail).toBe(errorLog);
      expect(result.iconName).toBe('AlertCircle');
    });

    test('テスト成功ログを正しく変換する', () => {
      const testLog = 'test passed ✓ All tests completed successfully';
      const result = transformLogToUserFriendly(testLog);

      expect(result.category).toBe('success');
      expect(result.message).toBe('✅ テストが正常に完了しました');
      expect(result.iconName).toBe('TestTube');
    });

    test('Git操作ログを正しく変換する', () => {
      const gitLog = 'git commit -m "Add new feature"';
      const result = transformLogToUserFriendly(gitLog);

      expect(result.category).toBe('success');
      expect(result.message).toBe('💾 変更をコミットしました');
      expect(result.iconName).toBe('GitBranch');
    });

    test('JSONログを正しく変換する', () => {
      const jsonLog =
        'Status: {"message": "Processing data", "status": "running", "taskId": "12345"}';
      const result = transformLogToUserFriendly(jsonLog);

      expect(result.category).toBe('info');
      expect(result.message).toContain('状態: running');
    });

    test('システム内部ログをフィルタリングする', () => {
      const systemLog =
        '{"agentId": "abc-123", "executionId": "def-456", "timestamp": "2024-01-01"}';
      const result = transformLogToUserFriendly(systemLog);

      expect(result.category).toBe('hidden');
      expect(result.message).toBe('');
    });

    test('空行をフィルタリングする', () => {
      const emptyLog = '   ';
      const result = transformLogToUserFriendly(emptyLog);

      expect(result.category).toBe('hidden');
      expect(result.message).toBe('');
    });

    test('不明なパターンのログをデフォルト処理する', () => {
      const unknownLog = 'Some unknown log message that does not match any pattern';
      const result = transformLogToUserFriendly(unknownLog);

      expect(result.category).toBe('info');
      expect(result.message).toBe(unknownLog);
    });

    test('長いメッセージを省略する', () => {
      const longLog =
        'This is a very long log message that should be truncated because it exceeds the maximum length limit that we have set for display purposes in the UI component';
      const result = transformLogToUserFriendly(longLog);

      expect(result.message.length).toBeLessThanOrEqual(83); // 80文字 + "..."
      expect(result.message).toContain('...');
      expect(result.detail).toBe(longLog);
    });
  });

  describe('transformLogsToSimple', () => {
    test('複数のログを変換し、hiddenカテゴリを除外する', () => {
      const logs = [
        '[research] 調査開始',
        '{"agentId": "internal-123"}', // hidden
        'file_edit Button.tsx',
        'Error: Compilation failed',
        '   ', // hidden (empty)
      ];

      const results = transformLogsToSimple(logs);

      expect(results).toHaveLength(3);
      expect(results[0].phase).toBe('research');
      expect(results[1].message).toContain('Button.tsx を編集しました');
      expect(results[2].category).toBe('error');
    });

    test('重複する進行中メッセージを統合する', () => {
      const logs = [
        'processing data',
        'waiting for response',
        'waiting for response', // duplicate
        'waiting for response', // duplicate
        'process completed',
      ];

      const results = transformLogsToSimple(logs);

      // 重複する "処理中です" メッセージが統合されることを確認
      const progressMessages = results.filter(
        (entry) => entry.category === 'progress' && entry.message === '⏳ 処理中です',
      );
      expect(progressMessages).toHaveLength(2); // "processing" と最初の "waiting"
    });
  });

  describe('detectCurrentPhase', () => {
    test('最新のフェーズを正しく検出する', () => {
      const logs = [
        '[research] 開始',
        'analyzing dependencies',
        '[plan] 計画作成',
        'creating implementation plan',
        '[implement] 実装開始',
      ];

      const phase = detectCurrentPhase(logs);
      expect(phase).toBe('implement');
    });

    test('フェーズが見つからない場合はnullを返す', () => {
      const logs = ['Some general log', 'Another log without phase'];

      const phase = detectCurrentPhase(logs);
      expect(phase).toBeNull();
    });

    test('空のログ配列でnullを返す', () => {
      const logs: string[] = [];

      const phase = detectCurrentPhase(logs);
      expect(phase).toBeNull();
    });

    test('複数のフェーズがある場合、最後のものを返す', () => {
      const logs = [
        '[research] 調査',
        '[plan] 計画',
        '[research] 追加調査', // 後で研究フェーズに戻る
      ];

      const phase = detectCurrentPhase(logs);
      expect(phase).toBe('research');
    });
  });

  describe('Edge cases', () => {
    test('null や undefined の入力を適切に処理する', () => {
      const result1 = transformLogToUserFriendly('');
      const result2 = transformLogToUserFriendly('null');

      expect(result1.category).toBe('hidden');
      expect(result2.category).toBe('info');
    });

    test('特殊文字を含むログを適切に処理する', () => {
      const specialLog = 'File with special chars: <test>&"quotes".json';
      const result = transformLogToUserFriendly(specialLog);

      expect(result.category).toBe('info');
      expect(result.message).toContain('special chars');
    });

    test('不正なJSONを含むログを適切に処理する', () => {
      const invalidJsonLog = 'Status: {invalid json structure';
      const result = transformLogToUserFriendly(invalidJsonLog);

      expect(result.category).toBe('info');
      expect(result.message).toBe(invalidJsonLog);
    });
  });
});
