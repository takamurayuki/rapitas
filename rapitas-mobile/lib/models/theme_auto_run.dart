/// テーマ自動実行（GET/POST /themes/:id/auto-run）の型。
///
/// バックエンドの ThemeAutoRunPublicState（rapitas-backend/services/workflow/auto-run/
/// theme-auto-run-types.ts）のうち、画面が使う項目だけを持つ。ID は他のモデルと同じく文字列にそろえる。
library;

/// 1テーマの自動実行の状態（応答の `autoRun`）。
class ThemeAutoRunState {
  final String themeId;
  final bool enabled;

  /// idle | running | paused | stopping。未知の値もそのまま持ち、表示側で生の値を出す
  final String status;

  /// paused のときの理由（user | awaiting_approval | unknown）。それ以外は null
  final String? pauseReason;

  /// priority | created
  final String order;
  final String? currentTaskId;
  final int processedCount;
  final String? lastError;

  const ThemeAutoRunState({
    required this.themeId,
    this.enabled = false,
    this.status = 'idle',
    this.pauseReason,
    this.order = 'priority',
    this.currentTaskId,
    this.processedCount = 0,
    this.lastError,
  });

  factory ThemeAutoRunState.fromJson(Map<String, dynamic> json, {required String themeId}) {
    final lastError = json['lastError'];
    return ThemeAutoRunState(
      themeId: json['themeId']?.toString() ?? themeId,
      enabled: json['enabled'] == true,
      status: json['status'] is String ? json['status'] as String : 'idle',
      pauseReason: json['pauseReason'] is String ? json['pauseReason'] as String : null,
      order: json['order'] == 'created' ? 'created' : 'priority',
      currentTaskId: json['currentTaskId']?.toString(),
      processedCount: (json['processedCount'] as num?)?.toInt() ?? 0,
      lastError: lastError is String && lastError.isNotEmpty ? lastError : null,
    );
  }

  bool get isRunning => status == 'running';
  bool get isPaused => status == 'paused';
  bool get isStopping => status == 'stopping';
  bool get isIdle => status == 'idle';
}

/// GET /themes/:id/auto-run の応答全体。currentTask はバックエンドが currentTaskId から引いたもの
class ThemeAutoRunSnapshot {
  final ThemeAutoRunState state;
  final String? currentTaskTitle;
  final int? remainingCount;

  const ThemeAutoRunSnapshot({required this.state, this.currentTaskTitle, this.remainingCount});

  factory ThemeAutoRunSnapshot.fromJson(Map<String, dynamic> json, {required String themeId}) {
    final autoRun = json['autoRun'];
    final currentTask = json['currentTask'];
    final title = currentTask is Map ? currentTask['title'] : null;
    return ThemeAutoRunSnapshot(
      state: ThemeAutoRunState.fromJson(
        autoRun is Map ? Map<String, dynamic>.from(autoRun) : const {},
        themeId: themeId,
      ),
      currentTaskTitle: title is String && title.isNotEmpty ? title : null,
      remainingCount: (json['remainingCount'] as num?)?.toInt(),
    );
  }
}
