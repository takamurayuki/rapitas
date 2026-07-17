/**
 * log-default-translations
 *
 * Fallback (Japanese) message templates for the log-classification pipeline.
 * Callers without an i18n context — including the pre-existing test suite —
 * get these strings; callers with a next-intl translator (scoped to
 * `devMode.logTransformer`) get localized messages instead. Keep the key set
 * in sync with `devMode.logTransformer` in messages/ja.json & en.json.
 */

import type { LogTranslate } from './log-pattern-rules';

const JA_TEMPLATES: Record<string, string> = {
  'phaseStart.research': '調査フェーズを開始しました',
  'phaseStart.plan': '計画フェーズを開始しました',
  'phaseStart.implement': '実装フェーズを開始しました',
  'phaseStart.verify': '検証フェーズを開始しました',
  fileEdited: '{basename} を編集しました',
  fileCreated: '新しいファイル {name} を作成しました',
  errorOccurred: 'エラーが発生しました',
  testsCompleted: 'テストが正常に完了しました',
  committed: '変更をコミットしました',
  processing: '処理中です',
  agentPrefix: 'エージェント: {text}',
  continuationResumed: '追加指示の実行を再開',
  agentInitializing: 'エージェントを初期化中...',
  thinking: '思考中…',
  systemEvent: 'システム: {name}',
  systemError: 'システムエラー: {detail}',
  providerStarting: '{provider} の実行を開始',
  workingDirectory: '作業ディレクトリ: {dir}',
  processStarted: 'プロセス起動 PID {pid}',
  timeoutSetting: 'タイムアウト設定: {timeout}',
  agentInstruction: 'エージェントへの指示: {summary}',
  providerTimedOut: '{provider} の実行がタイムアウトしました',
  providerError: '{provider} エラー: {detail}',
  executionCompleted: '実行完了',
  executionFailed: '実行失敗 ({status})',
  toolRead: '読込 {path}',
  toolEdit: '編集 {path}',
  toolWrite: '作成 {path}',
  testRunning: 'テストを実行中...',
  verifyRunning: '検証コマンドを実行中...',
  committing: 'コミット中...',
  pushing: 'リモートにプッシュ中...',
  gitCommand: 'Git: {cmd}',
  searchCommand: '調査: {cmd}',
  shellCommand: '$ {cmd}',
  toolSearch: '検索 {query}',
  webSearch: 'Web検索: {query}',
  webFetch: 'Web取得: {url}',
  subAgent: 'サブエージェント: {text}',
  subAgentStarting: '起動中...',
  itemCount: '{count}件',
  objectDataPlaceholder: '(データ)',
  toolErrorSuffix: '{name} でエラー',
  questionPrefix: '質問: {text}',
  testsPassedCount: 'テスト {count}件成功',
  testsFailedCount: 'テスト {count}件失敗',
  typecheckRunning: '型チェックを実行中...',
  commitMessage: 'コミット: {message}',
  pushCompleted: 'リモートにプッシュ完了',
  waitingForAnswer: '回答を待っています...',
  timedOut: 'タイムアウトしました',
  mdContent: 'Markdownコンテンツ ({chars}文字)',
  mdContentNamed: '{name} の内容 ({chars}文字)',
  jsonStatus: '状態: {status}',
  jsonStatusTranslated: '状態: {status} ({translated})',
  jsonTaskId: 'タスク: {taskId}',
  'statusLabels.running': '実行中',
  'statusLabels.completed': '完了',
  'statusLabels.failed': '失敗',
  'statusLabels.pending': '待機中',
  'statusLabels.cancelled': '中止',
  'statusLabels.waitingForInput': '回答待ち',
  'statusLabels.inProgress': '進行中',
  'statusLabels.todo': '未着手',
  'statusLabels.waiting': '待機中',
  'statusLabels.success': '成功',
};

/** Resolves `{param}` placeholders in a template string. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in params ? String(params[key]) : match,
  );
}

/** Default translator: returns the original Japanese source strings. */
export const defaultT: LogTranslate = (key, params) =>
  interpolate(JA_TEMPLATES[key] ?? key, params);
