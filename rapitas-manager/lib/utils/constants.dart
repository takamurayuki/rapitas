class AppConstants {
  static const String appName = 'Rapitas Manager';
  static const String defaultLocale = 'ja_JP';

  static const Map<String, String> statusLabels = {
    'todo': '未着手',
    'in-progress': '進行中',
    'done': '完了',
  };

  static const Map<String, String> priorityLabels = {
    'low': '低',
    'medium': '中',
    'high': '高',
    'urgent': '緊急',
  };

  static const Map<String, String> executionStatusLabels = {
    'pending': '待機中',
    'running': '実行中',
    'completed': '完了',
    'failed': '失敗',
    'cancelled': 'キャンセル',
    'interrupted': '中断',
  };

  static const Map<String, String> approvalStatusLabels = {
    'pending': '保留中',
    'approved': '承認済み',
    'rejected': '却下',
    'expired': '期限切れ',
  };
}
