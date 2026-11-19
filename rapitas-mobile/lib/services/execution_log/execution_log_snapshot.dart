/// 実行ログの取得結果（GET /tasks/:id/execution-logs）を、表示に使う形で持つ。
///
/// 分類（どれを出来事として見せるか）はここではしない。それは execution_log_digest.dart の役目。
library;

/// 実行ログの1行。バックエンドの AgentExecutionLog の1行（= エージェントの出力1回分）。
class ExecutionLogEntry {
  /// 出力そのもの（複数行のことがある）
  final String chunk;

  /// `stdout` か `stderr`（log-chunk-manager.ts が書くのはこの2値だけ）
  final String type;
  final int sequence;
  final DateTime? timestamp;

  /// セッション全体モードでの実行の並び（0 が最新）。単一実行モードでは 0
  final int executionIndex;

  const ExecutionLogEntry({
    required this.chunk,
    required this.type,
    required this.sequence,
    this.timestamp,
    this.executionIndex = 0,
  });

  bool get isStderr => type == 'stderr';
}

/// 1回の取得で得た実行ログと、その実行の状態。
class ExecutionLogSnapshot {
  /// 古い実行 → 新しい実行、各実行の中は sequence 順
  final List<ExecutionLogEntry> entries;

  /// 実行の状態（running / waiting_for_input / completed / failed / cancelled / interrupted / none など）
  final String status;
  final String? question;
  final String? errorMessage;

  const ExecutionLogSnapshot({
    this.entries = const [],
    this.status = 'none',
    this.question,
    this.errorMessage,
  });

  /// API の応答を読む。単一実行モード（executionId 指定）とセッション全体モードの両方に対応する。
  ///
  /// NOTE: セッション全体モードの logs は実行を createdAt 降順で並べて展開したもの
  /// （agent-audit-router.ts）なので、そのままだと新しい実行のログが先に来る。
  /// 時系列で読めるよう executionIndex の大きい（古い）順に並べ直す。
  ///
  /// @param data - レスポンス本文 / レスポンスの JSON
  /// @returns 読み取った結果（形が違えば空） / 実行ログ
  factory ExecutionLogSnapshot.fromJson(dynamic data) {
    if (data is! Map) return const ExecutionLogSnapshot();
    final rows = (data['logs'] as List? ?? const []).whereType<Map>().toList();
    final entries = <ExecutionLogEntry>[
      for (final row in rows)
        ExecutionLogEntry(
          chunk: row['chunk']?.toString() ?? '',
          type: row['type']?.toString() ?? 'stdout',
          sequence: (row['sequence'] as num?)?.toInt() ?? 0,
          timestamp: row['timestamp'] == null ? null : DateTime.tryParse(row['timestamp'].toString()),
          executionIndex: (row['executionIndex'] as num?)?.toInt() ?? 0,
        ),
    ];
    // List.sort は安定ではないので、元の位置も比較に使う
    final indexed = entries.asMap().entries.toList()
      ..sort((a, b) {
        final byExecution = b.value.executionIndex.compareTo(a.value.executionIndex);
        if (byExecution != 0) return byExecution;
        final bySequence = a.value.sequence.compareTo(b.value.sequence);
        return bySequence != 0 ? bySequence : a.key.compareTo(b.key);
      });

    // セッション全体モードでは質問・エラーは各行に付いて来る。最新の実行の行から拾う
    final latestRow = rows.where((r) => ((r['executionIndex'] as num?)?.toInt() ?? 0) == 0).firstOrNull;
    String? pick(String key) {
      final value = data[key] ?? latestRow?[key];
      return value is String && value.trim().isNotEmpty ? value : null;
    }

    return ExecutionLogSnapshot(
      entries: [for (final e in indexed) e.value],
      status: data['status']?.toString() ?? 'none',
      question: pick('question'),
      errorMessage: pick('errorMessage'),
    );
  }
}
